import 'server-only';

import { inngest } from './client';
import { createStructuredLogger } from '@/lib/core/logger';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { agentRegistry } from '@/lib/agent-registry';
import { provisionAgentWallet } from '@/lib/altana-signer';
import { writeAuditEvent } from '@/lib/jobs/job-repo';

const logger = createStructuredLogger('inngest.reconcile');

/**
 * Reconciliation systems for the BAN control plane.
 *
 * 1. banTaskReconcile — "active tasks keep running":
 *    Every 2 minutes, for each ACTIVE agent that still has an ACTIVE task
 *    (status !== 'FAILED' and expiresAtMs in the future), send a
 *    ban/agent.tick-loop event so the self-sustaining closed loop keeps
 *    ticking for THAT task's agent — even if the original kick was lost
 *    during a redeploy or the cloud cron backstop is not registered.
 *
 * 2. banWalletProvisionSweep — "no deployed agent left without a wallet":
 *    Every minute, find deployed (non-REVOKED) agents that were not
 *    provisioned a wallet (missing walletAddress / walletStatus !=
 *    'provisioned') and provision one idempotently via the Firestore-backed,
 *    encrypted per-agent keystore. The derived address (never the key) is
 *    bound to the agent + an audit event is written.
 *
 * Both are idempotent and Admin-SDK-only (never touch the client surface).
 */

// ---------------------------------------------------------------------------
// 1) Active-task loop trigger
// ---------------------------------------------------------------------------

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

export const banTaskReconcile = inngest.createFunction(
  {
    id: 'ban-task-reconcile',
    retries: 1,
    triggers: [{ cron: '*/2 * * * *' }],
    concurrency: 1,
  },
  async ({ step }) => {
    const correlationId = `reconcile_tasks_${Date.now()}`;
    logger.info('task_reconcile_started', { correlationId });

    const agents = await agentRegistry.list({ status: 'ACTIVE', limit: 50 });
    let kicked = 0;

    for (const agent of agents) {
      await step.run(`kick-${agent.id}`, async () => {
        const active = await hasActiveTask(agent.id);
        if (!active) {
          return { agentId: agent.id, kicked: false, reason: 'no_active_task' };
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

// ---------------------------------------------------------------------------
// 2) Wallet provisioning sweep
// ---------------------------------------------------------------------------

export const banWalletProvisionSweep = inngest.createFunction(
  {
    id: 'ban-wallet-provision-sweep',
    retries: 1,
    triggers: [{ cron: '*/2 * * * *' }],
    concurrency: 1,
  },
  async ({ step }) => {
    const correlationId = `reconcile_wallets_${Date.now()}`;
    logger.info('wallet_sweep_started', { correlationId });

    // Pull a bounded set (newest first); filter REVOKED + already-provisioned
    // in memory so we never accidentally touch a terminal or healthy agent.
    const agents = await agentRegistry.list({ limit: 100 });
    const candidates = agents.filter((a) => {
      if (a.status === 'REVOKED') return false;
      const hasWallet = Boolean(a.walletAddress);
      const provisioned = (a as { walletStatus?: string }).walletStatus === 'provisioned';
      return !hasWallet || !provisioned;
    });

    let provisioned = 0;
    let failed = 0;

    for (const agent of candidates) {
      await step.run(`provision-${agent.id}`, async () => {
        try {
          const result = await provisionAgentWallet(agent.id);
          const db = getAdminDb();
          await db
            .collection(collections.agents)
            .doc(agent.id)
            .update({
              walletAddress: result.walletAddress,
              walletStatus: 'provisioned',
              walletProvisionedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          await writeAuditEvent({
            eventType: 'AGENT_WALLET_PROVISIONED',
            correlationId,
            jobId: `sweep_${agent.id}`,
            agentId: agent.id,
            payload: { walletAddress: result.walletAddress, source: 'reconcile-sweep', generatedKey: result.generatedKey },
          });
          logger.info('wallet_sweep_provisioned', {
            agentId: agent.id,
            address: result.walletAddress,
            correlationId,
          });
          return { agentId: agent.id, ok: true, walletAddress: result.walletAddress };
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          logger.error('wallet_sweep_provision_failed', { agentId: agent.id, correlationId, message });
          return { agentId: agent.id, ok: false, reason: message };
        }
      });
      provisioned += 1;
    }

    logger.info('wallet_sweep_finished', {
      correlationId,
      candidates: candidates.length,
      provisioned,
      failed,
    });
    return { ok: true, candidates: candidates.length, provisioned, failed };
  }
);

export const reconcileFunctions = [banTaskReconcile, banWalletProvisionSweep];