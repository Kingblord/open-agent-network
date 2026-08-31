import 'server-only';

import { inngest } from './client';
import { QUEUES, type InngestConcurrencyLimit } from './queues';
import { createStructuredLogger } from '@/lib/core/logger';
import { updateJobStatus, writeDeadLetter, writeAuditEvent } from '@/lib/jobs/job-repo';
import { classifyRetry, resolveTestFailure } from '@/lib/jobs/job-common';
import { BANError, ErrorCode } from '@ban/shared';
import { agentRegistry } from '@/lib/agent-registry';
import { runAgentCycle } from '@/lib/agent-runtime/run-cycle';
import { persistAuditEvent } from '@/lib/agent-runtime/persistence';
import { reconcileFunctions } from './reconcile';

const logger = createStructuredLogger('inngest.jobs');

interface QueueEvent {
  jobType: string;
  jobId: string;
  agentId: string;
  userId: string;
  correlationId: string;
  idempotencyKey: string;
  attempt: number;
  payload: Record<string, unknown>;
}

/**
 * M2 - Durable Job System worker set.
 *
 * A generic worker handles every queue. It:
 *   1. marks the job RUNNING for the current attempt,
 *   2. runs a queue-agnostic "process" step (M2 scope is the durable system,
 *      not per-agent business logic — agents arrive in M3+),
 *   3. honors a DEV-ONLY failure directive (retryable / terminal) needed to
 *      prove the Done-when loop (intentionally fail -> retry -> dead-letter),
 *   4. persists SUCCEEDED + an audit event on success.
 *
 * On failure, Inngest retries with exponential backoff per the queue config.
 * When the retry budget is exhausted, the failure handler classifies the
 * error and DEAD_LETTERs it + writes an audit event (never blindly resubmits
 * a financial action).
 */

async function runQueueWorkflow(event: QueueEvent, step: { run: (id: string, fn: () => Promise<unknown>) => Promise<unknown> }) {
  const { jobId, jobType, correlationId, attempt, payload } = event;

  // 1. Mark running.
  await updateJobStatus(jobId, 'RUNNING', { attempt });

  // 2. Process step (durable boundary) — generic handler for M2.
  await step.run('process-job', async () => {
    // Deterministic dev/test failure hook (never produced in a real payload).
    const failure = resolveTestFailure(payload);
    if (failure.kind === 'terminal') {
      throw new BANError(ErrorCode.EXECUTION_FAILED, 'terminal test failure', {
        correlationId,
        retryable: false,
      });
    }
    if (failure.kind === 'retryable' && attempt <= failure.attempts) {
      throw new BANError(ErrorCode.RPC_TIMEOUT, `transient test failure (attempt ${attempt})`, {
        correlationId,
        retryable: true,
      });
    }
    return { processed: true, queue: jobType };
  });

  // 3. Success -> persist + audit.
  await updateJobStatus(jobId, 'SUCCEEDED', { attempt });
  await writeAuditEvent({
    eventType: 'JOB_SUCCEEDED',
    correlationId: event.correlationId,
    jobId,
    agentId: event.agentId,
    payload: { jobType, agentId: event.agentId, userId: event.userId, idempotencyKey: event.idempotencyKey },
  });
  logger.info('job_succeeded', { jobId, jobType, correlationId: event.correlationId, attempt });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Failure handler -> DEAD_LETTER + audit (M2 failure loop)
// ---------------------------------------------------------------------------

async function handleFailure({ error, event }: { error: Error; event: any }) {
  const data = event?.data ?? {};
  const jobId: string = data.jobId;
  const jobType: string = data.jobType ?? 'unknown';
  const correlationId: string = data.correlationId ?? 'unknown';
  const attempt: number = data.attempt ?? 1;

  const classification = classifyRetry({ code: (error as BANError)?.code, name: error?.name });

  logger.error('job_failed', {
    jobId,
    jobType,
    correlationId,
    error: { ...classification, message: error?.message },
    attempt,
  });

  await updateJobStatus(jobId, 'DEAD_LETTER', {
    attempt,
    lastError: { code: (error as BANError)?.code ?? classification.reason, message: error.message },
  });

  await writeDeadLetter(
    {
      jobId,
      jobType: jobType as never,
      agentId: data.agentId,
      userId: data.userId,
      correlationId,
      idempotencyKey: data.idempotencyKey,
      payload: data.payload ?? {},
    } as never,
    { code: (error as BANError)?.code ?? classification.reason, message: error.message }
  );

  await writeAuditEvent({
    eventType: 'JOB_DEAD_LETTERED',
    correlationId,
    jobId,
    agentId: data.agentId,
    payload: { jobType, reason: classification.reason, attempt },
  });
}

export const banPing = inngest.createFunction(
  {
    id: 'ban-ping',
    retries: 2,
    triggers: [{ event: 'ban/m1.ping' }],
  },
  async ({ event, step }) => {
    const correlationId = event.data.correlationId ?? 'unset';
    await step.sleep('short-delay', '1s');
    logger.info('ban_ping_processed', { correlationId });
    return { ok: true, correlationId };
  }
);

// Inngest's retries/concurrency options accept only a limited literal union.
// maxAttempts ∈ {2,3,4}, so maxAttempts-1 ∈ {1,2,3}, all legal retry counts.
const asInngestRetries = (attempts: number) => attempts as 0 | 1 | 2 | 3;

// One generic worker per configured queue.
export const queueWorkers = QUEUES.map((cfg) =>
  inngest.createFunction(
    {
      id: `ban-job-${cfg.queue}`,
      triggers: [{ event: cfg.event }],
      retries: asInngestRetries(cfg.maxAttempts - 1),
      // TS treats Inngest's own concurrency literal union as distinct from
      // ours, so we cast the already-validated value here.
      concurrency: cfg.concurrencyLimit as InngestConcurrencyLimit,
      onFailure: handleFailure,
    },
    async ({ event, step }) =>
      runQueueWorkflow(event.data as QueueEvent, step)
  )
);

// ---------------------------------------------------------------------------
// M1/M9-M12 — Autonomous agent tick (scheduled closed-loop runner)
//
// Runs every minute (Inngest `cron` trigger — NOT GitHub Actions cron, NOT
// a local timer, NOT Firestore-as-queue: all forbidden by the automation stack
// table). For each ACTIVE agent (with a provisioned wallet), it enqueues a
// single closed-loop cycle via runAgentCycle as a durable step.
//
// The tick itself is idempotent at the loop level: runAgentCycle persists its
// own idempotency/reservation and never blindly re-broadcasts a financial
// action (Rule 5). Concurrency is capped so we never fan out more than a few
// agents per tick in dev.
// ---------------------------------------------------------------------------

export const banAgentTick = inngest.createFunction(
  {
    id: 'ban-agent-tick',
    retries: 1,
    // Every minute, aligned for health-factor reaction windows (M1).
    triggers: [{ cron: '*/1 * * * *' }],
    concurrency: 1,
  },
  async ({ step }) => {
    const correlationId = `tick_${Date.now()}`;
    logger.info('agent_tick_started', { correlationId });

    // Any ACTIVE agent (registry state machine guarantees ownership/wallet).
    const agents = await agentRegistry.list({ status: 'ACTIVE', limit: 50 });

    let ran = 0;
    for (const agent of agents) {
      await step.run(`cycle-${agent.id}`, async () => {
        const result = await runAgentCycle({
          agentId: agent.id,
          userId: agent.ownerId,
          correlationId,
        });

        // Heartbeat: proves the Inngest cron reached THIS agent and records
        // the real cycle outcome (observability, Rule 10). Written through
        // persistAuditEvent so it lands in the same `audit_events` collection
        // /activity reads (the route maps stored `type`/`detail` -> the
        // `eventType`/`payload` response shape). The stage is NEVER
        // fabricated — it is the literal CycleResult from runAgentCycle
        // (observed|decided|awaited|confirmed).
        // Heartbeat write is best-effort observability (Rule 10): a failure
        // here must NEVER abort the tick (it is not a transaction outcome) —
        // the loop continues even if the audit write is down.
        try {
          await persistAuditEvent({
            type: 'AGENT_TICK',
            correlationId,
            agentId: agent.id,
            detail: {
              source: 'inngest-cron',
              schedule: '*/1 * * * *',
              cycleResult: result,
            },
          });
          logger.info('agent_tick_heartbeat_written', {
            agentId: agent.id,
            correlationId,
            cycleStage: result.ok ? result.stage : result.reason,
          });
        } catch (hbErr) {
          logger.error('agent_tick_heartbeat_failed', {
            agentId: agent.id,
            correlationId,
            error: hbErr instanceof Error ? hbErr.message : String(hbErr),
          });
        }

        logger.info('agent_tick_cycle', {
          agentId: agent.id,
          result: result,
          correlationId,
        });
        return result;
      });
      ran += 1;
    }

    logger.info('agent_tick_finished', { correlationId, agents: agents.length, ran });
    return { ok: true, agents: agents.length, ran };
  }
);

// ---------------------------------------------------------------------------
// M1/M9-M12 — Self-sustaining per-agent loop (ban/agent.tick-loop)
//
// The cron above only fires if Inngest Cloud registration is configured
// (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY + /api/inngest). To guarantee the
// loop "keeps going" even when the cloud cron is not registered, each ACTIVE
// agent is driven by a self-chaining event: run one honest cycle, write the
// AGENT_TICK heartbeat, sleep ~50 seconds, then send the NEXT ban/agent.tick-loop.
//
// This is NOT Firestore-as-a-queue: Inngest owns the scheduling/delivery; the
// Firestore lease (agent_loop_state) only prevents overlapping chains when the
// cron backstop + task-kick + retry deliveries race. The loop dies when the
// agent leaves ACTIVE.
// ---------------------------------------------------------------------------

export const banAgentLoop = inngest.createFunction(
  {
    id: 'ban-agent-loop',
    retries: 1,
    triggers: [{ event: 'ban/agent.tick-loop' }],
    concurrency: 3,
  },
  async ({ event, step }) => {
    const agentId = String(event.data?.agentId ?? '');
    const userId = String(event.data?.userId ?? '');
    const correlationId = String(event.data?.correlationId ?? `loop_${Date.now()}`);
    if (!agentId) return { ok: false, reason: 'missing_agent_id' };

    const agent = await agentRegistry.getById(agentId);
    if (!agent) return { ok: false, reason: 'agent_not_found' };

    // If the agent is not ACTIVE, stop the chain (do not keep scheduling).
    const status = String(agent.status ?? '');
    if (status !== 'ACTIVE') {
      // No heartbeat; the loop dies quietly until a task (re)activates it.
      return { ok: true, stopped: status, reason: 'agent_not_active' };
    }

    // Run one honest closed-loop cycle.
    const result = await runAgentCycle({
      agentId,
      userId: String(agent.ownerId ?? userId),
      correlationId,
    });

    // Heartbeat: proves the Inngest loop reached THIS agent and records the
    // real cycle outcome. Written through persistAuditEvent so it lands in the
    // same `audit_events` collection /activity reads (the route maps stored
    // `type`/`detail` -> the `eventType`/`payload` response shape).
    // Heartbeat write is best-effort observability (Rule 10): a failure
    // here must NEVER kill the self-chain (it is not a transaction outcome).
    try {
      await persistAuditEvent({
        type: 'AGENT_TICK',
        correlationId,
        agentId,
        detail: {
          source: 'inngest-loop',
          schedule: 'self-chaining every 50s',
          cycleResult: result,
        },
      });
      logger.info('agent_tick_heartbeat_written', {
        agentId,
        correlationId,
        cycleStage: result.ok ? result.stage : result.reason,
      });
    } catch (hbErr) {
      logger.error('agent_tick_heartbeat_failed', {
        agentId,
        correlationId,
        error: hbErr instanceof Error ? hbErr.message : String(hbErr),
      });
    }

    // Self-schedule the next tick in ~50 seconds (while ACTIVE). This is what
    // makes the loop "keep going" even when the cloud cron is not registered.
    // The Firestore lease (agent_loop_state) prevents overlapping chains.
    await step.sleep('before-next-tick', '50s');
    await inngest.send({
      name: 'ban/agent.tick-loop',
      data: {
        agentId,
        userId: String(agent.ownerId ?? userId),
        correlationId: `loop_${Date.now()}`,
      },
    });

    logger.info('agent_loop_ticked', { agentId, correlationId, result });
    return { ok: true, result };
  }
);

export const functions = [banPing, banAgentTick, banAgentLoop, ...queueWorkers, ...reconcileFunctions];