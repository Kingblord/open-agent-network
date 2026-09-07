import 'server-only';

import { inngest } from './client';
import { createStructuredLogger } from '@/lib/core/logger';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { agentRegistry } from '@/lib/agent-registry';
const logger = createStructuredLogger('inngest.reconcile');

/**
 * Reconciliation — only runs Inngest when monitoring is actively needed.
 *
 * 1. banTaskReconcile (SAFETY NET, every 5 min): re-kicks the self-chaining
 *    agent loop for ACTIVE agents that have BOTH an active task AND an active
 *    session. It never runs cycles itself — ban-agent-loop is the single
 *    cycle driver. This heals chains lost to redeploys/missed deliveries.
 *
 * 2. banExecutionReconcile (CONFIRM-WATCHER, every 2 min): reconciles
 *    EXECUTING executions against real on-chain receipts (see below).
 */

interface TaskLike {
  taskId?: string;
  agentId?: string;
  status?: string;
  config?: { expiresAtMs?: number };
}

async function hasActiveTask(agentId: string): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db
    .collection(collections.agentTasks ?? 'agent_tasks')
    .where('agentId', '==', agentId)
    .limit(20)
    .get();
  const now = Date.now();
  let active = false;
  snap.forEach((doc) => {
    const t = doc.data() as TaskLike;
    if (!t || t.status === 'FAILED') return;
    const expiresAt = t.config?.expiresAtMs ?? 0;
    if (expiresAt > now) active = true;
  });
  return active;
}

async function hasActiveSession(agentId: string): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db
    .collection(collections.agentSessions ?? 'agent_sessions')
    .where('agentId', '==', agentId)
    .where('status', '==', 'ACTIVE')
    .limit(5)
    .get();
  return !snap.empty;
}

export const banTaskReconcile = inngest.createFunction(
  {
    id: 'ban-task-reconcile',
    retries: 1,
    // Safety net only — the self-chaining ban-agent-loop is the SINGLE cycle
    // driver. This re-kicks chains lost to redeploys/missed deliveries; it
    // never runs cycles itself. 5-minute cadence is plenty for that.
    triggers: [{ cron: '*/5 * * * *' }],
    concurrency: 1,
  },
  async ({ step }) => {
    const correlationId = `reconcile_tasks_${Date.now()}`;
    logger.info('task_reconcile_started', { correlationId });

    const agents = await agentRegistry.list({ status: 'ACTIVE', limit: 50 });
    let kicked = 0;

    for (const agent of agents) {
      await step.run(`kick-${agent.id}`, async () => {
        // Only kick if BOTH an active task AND an active session exist
        const [activeTask, activeSession] = await Promise.all([
          hasActiveTask(agent.id),
          hasActiveSession(agent.id),
        ]);
        if (!activeTask) {
          return { agentId: agent.id, kicked: false, reason: 'no_active_task' };
        }
        if (!activeSession) {
          return { agentId: agent.id, kicked: false, reason: 'no_active_session' };
        }
        await inngest.send({
          name: 'ban/agent.tick-loop',
          data: {
            agentId: agent.id,
            userId: String(agent.ownerId ?? ''),
            correlationId: `reconcile_${Date.now()}`,
          },
        });
        logger.info('task_reconcile_kicked', { agentId: agent.id, correlationId });
        return { agentId: agent.id, kicked: true };
      });
      kicked += 1;
    }

    logger.info('task_reconcile_finished', { correlationId, agents: agents.length, kicked });
    return { ok: true, agents: agents.length, kicked };
  }
);

/**
 * banExecutionReconcile — the CONFIRM-WATCHER (real-funds honesty loop).
 *
 * Every 2 minutes, reconciles executions stuck in EXECUTING (submissions the
 * backend could not confirm synchronously — e.g. Altana `callsId` batch ids)
 * against the actual chain:
 *   - tx-hash-shaped id → fetch the receipt; success → CONFIRMED (+ gas),
 *     reverted → FAILED; no receipt yet → wait (until 30 min, then FAILED
 *     'confirmation_timeout').
 *   - non-hash id (backend batch id) → after 24h mark FAILED
 *     'submission_unverifiable' (honest: we can never prove it confirmed).
 *
 * Every transition persists an audit event — no state change is silent, and
 * nothing is ever flipped to CONFIRMED without an on-chain receipt.
 */
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

async function reconcileExecutionsOnce(correlationId: string): Promise<{
  checked: number;
  confirmed: number;
  failed: number;
}> {
  const { createPublicClient, http } = await import('viem');
  const { bsc } = await import('viem/chains');
  const client = createPublicClient({ chain: bsc, transport: http(process.env.BAN_RPC_URL || 'https://bsc-dataseed1.binance.org') });

  const db = getAdminDb();
  const snap = await db
    .collection(collections.executions)
    .where('status', '==', 'EXECUTING')
    .limit(25)
    .get();

  let checked = 0;
  let confirmed = 0;
  let failed = 0;

  const updates: Promise<unknown>[] = [];
  snap.forEach((doc) => {
    const e = doc.data() as {
      transactionHash?: string | null;
      agentId?: string;
      userId?: string;
      proposalId?: string;
      createdAt?: string;
    };
    checked += 1;
    const txHash = e.transactionHash ?? '';
    const createdAtMs = e.createdAt ? new Date(e.createdAt).getTime() : 0;
    const ageMs = Date.now() - createdAtMs;

    if (TX_HASH_RE.test(txHash)) {
      updates.push(
        (async () => {
          try {
            const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
            if (receipt && receipt.status === 'success') {
              await doc.ref.update({
                status: 'CONFIRMED',
                confirmedAt: new Date().toISOString(),
                gasUsed: receipt.gasUsed?.toString() ?? null,
              });
              confirmed += 1;
              await persistAuditEventSafe({
                type: 'TRANSACTION_CONFIRMED',
                correlationId,
                agentId: e.agentId,
                userId: e.userId,
                proposalId: e.proposalId,
                executionId: doc.id,
                detail: { transactionHash: txHash, via: 'confirm-watcher' },
              });
            } else if (receipt) {
              await doc.ref.update({
                status: 'FAILED',
                confirmedAt: null,
                errorCode: 'transaction_reverted_onchain',
              });
              failed += 1;
              await persistAuditEventSafe({
                type: 'TRANSACTION_FAILED',
                correlationId,
                agentId: e.agentId,
                userId: e.userId,
                proposalId: e.proposalId,
                executionId: doc.id,
                severity: 'ERROR',
                detail: { transactionHash: txHash, reason: 'reverted on-chain (confirm-watcher)' },
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Receipt-not-found is expected for pending txs; only age out.
            if (!/not found|pending/i.test(msg) && ageMs > 30 * 60 * 1000) {
              await doc.ref.update({ status: 'FAILED', errorCode: 'confirmation_timeout' });
              failed += 1;
            }
          }
        })(),
      );
    } else if (ageMs > 24 * 60 * 60 * 1000) {
      updates.push(
        (async () => {
          await doc.ref.update({ status: 'FAILED', errorCode: 'submission_unverifiable' });
          failed += 1;
          await persistAuditEventSafe({
            type: 'TRANSACTION_FAILED',
            correlationId,
            agentId: e.agentId,
            userId: e.userId,
            proposalId: e.proposalId,
            executionId: doc.id,
            severity: 'ERROR',
            detail: { id: txHash, reason: 'backend submission id never resolved to an on-chain tx within 24h' },
          });
        })(),
      );
    }
  });

  await Promise.allSettled(updates);
  return { checked, confirmed, failed };
}

/** Audit persistence that never throws into the Inngest step. */
async function persistAuditEventSafe(input: {
  type: string;
  correlationId: string;
  agentId?: string;
  userId?: string;
  proposalId?: string;
  executionId?: string;
  severity?: 'INFO' | 'WARN' | 'ERROR';
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { persistAuditEvent } = await import('@/lib/agent-runtime/persistence');
    await persistAuditEvent({
      type: input.type,
      severity: input.severity ?? 'INFO',
      correlationId: input.correlationId,
      agentId: input.agentId,
      userId: input.userId,
      proposalId: input.proposalId,
      executionId: input.executionId,
      detail: input.detail ?? {},
    });
  } catch (err) {
    logger.warn('confirm_watcher_audit_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export const banExecutionReconcile = inngest.createFunction(
  {
    id: 'ban-execution-reconcile',
    retries: 1,
    triggers: [{ cron: '*/2 * * * *' }],
    concurrency: 1,
  },
  async ({ step }) => {
    const correlationId = `reconcile_exec_${Date.now()}`;
    const result = await step.run('reconcile-executions', async () =>
      reconcileExecutionsOnce(correlationId),
    );
    logger.info('execution_reconcile_finished', { correlationId, ...result });
    return { ok: true, ...result };
  }
);

export const reconcileFunctions = [banTaskReconcile, banExecutionReconcile];