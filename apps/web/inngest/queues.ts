import type { JobType } from '@ban/schemas';

/**
 * M2 - Durable Job System: queue registry.
 *
 * Each queue declares its Inngest event name plus the async control knobs:
 * retries (max attempts), exponential backoff (seconds), and the Inngest
 * concurrency limit (max jobs of this queue executing at once).
 *
 * These do NOT make Firestore a queue — Inngest owns dispatch/retry/scheduling;
 * Firestore only persists job status/audit state.
 *
 * Inngest's createFunction `concurrency` option only accepts a specific
 * literal-union value, so `concurrencyLimit` is typed as that literal union
 * (rather than a bare `number`), keeping the queue definitions type-safe.
 */

// Allowed Inngest concurrency values for a single execution mode constraint.
// NOTE: values are capped at 4 — the Inngest plan enforces a maximum
// concurrency of 5 per function, and 6 was rejected at deploy time
// ("ban-job-market-data has higher concurrency limits (6) than your plan
// limit of 5"). Keeping ≤4 leaves headroom under the plan cap.
export type InngestConcurrencyLimit = 1 | 2 | 3 | 4;

export interface QueueConfig {
  /** Stable queue id, one of the M2 JobType values. */
  queue: JobType;
  /** Inngest event that triggers this queue's worker. */
  event: string;
  /** Maximum attempts (incl. initial) before DEAD_LETTER. */
  maxAttempts: number;
  /** Exponential backoff base, in seconds, before the next retry. */
  backoffSeconds: number;
  /** Max concurrent executions of this queue. */
  concurrencyLimit: InngestConcurrencyLimit;
}

const Q = {
  observation: 'agent-observation',
  decision: 'agent-decision',
  execution: 'agent-execution',
  market: 'market-data',
  positionSync: 'position-sync',
  performance: 'performance',
} as const;

export const QUEUES: QueueConfig[] = [
  { queue: Q.observation, event: 'ban/job.agent-observation', maxAttempts: 3, backoffSeconds: 2, concurrencyLimit: 4 },
  { queue: Q.decision,    event: 'ban/job.agent-decision',    maxAttempts: 3, backoffSeconds: 2, concurrencyLimit: 2 },
  {
    // Financial execution: stricter — retry must reconcile, never blindly
    // resubmit (Rule 5). Keep attempts low so a flaky provider produces a
    // FAILED/DEAD_LETTER for manual review rather than duplicated execution.
    queue: Q.execution,
    event: 'ban/job.agent-execution',
    maxAttempts: 2,
    backoffSeconds: 5,
    concurrencyLimit: 1,
  },
  { queue: Q.market,      event: 'ban/job.market-data',        maxAttempts: 4, backoffSeconds: 2, concurrencyLimit: 4 },
  { queue: Q.positionSync,event: 'ban/job.position-sync',      maxAttempts: 3, backoffSeconds: 3, concurrencyLimit: 3 },
  { queue: Q.performance, event: 'ban/job.performance',        maxAttempts: 3, backoffSeconds: 3, concurrencyLimit: 2 },
];

export function queueConfigFor(queue: JobType): QueueConfig | undefined {
  return QUEUES.find((q) => q.queue === queue);
}

export function eventFor(queue: JobType): string | undefined {
  return queueConfigFor(queue)?.event;
}