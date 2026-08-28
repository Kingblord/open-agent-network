import { z } from 'zod';
import { JobTypeSchema, JobStatusSchema } from '@ban/schemas';
import { ErrorCode, generateIdempotencyKey } from '@ban/shared';

/**
 * M2 - Durable Job System: shared, runtime-agnostic job logic.
 *
 * Kept free of any Firebase/Next.js import so it can be unit-tested in
 * isolation (see tests/job-classification.test.ts) and reused by both the
 * control-plane API routes and the Inngest workers.
 */

// ---------------------------------------------------------------------------
// Job input contract (what the enqueue endpoint + API/Event accepts)
// ---------------------------------------------------------------------------

export const JobEnqueueSchema = z.object({
  jobType: JobTypeSchema,
  agentId: z.string().min(1),
  userId: z.string().min(1),
  // Caller may provide an idempotency key. If omitted (free-form dev tests)
  // a deterministic one is derived from a callerHash so duplicate enqueues of
  // the same payload still collapse — but every financial job MUST provide one.
  idempotencyKey: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  // Zod v4: `record` requires (keySchema, valueSchema).
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type JobEnqueueInput = z.infer<typeof JobEnqueueSchema>;

// ---------------------------------------------------------------------------
// Retry classification policy (Rule 5, M2 "retry classification")
// ---------------------------------------------------------------------------

/** Error codes that are safe to retry (transient / provider-level). */
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  ErrorCode.PROVIDER_UNAVAILABLE,
  ErrorCode.RPC_TIMEOUT,
]);

/**
 * Classify an error for (non)retryability.
 * - Safe-to-retry: transient infra failures.
 * - Do-not-retry: policy rejections, validation, idempotency conflicts,
 *   and onchain terminal failures (revert/insufficient/slippage).
 *
 * Returns a machine-readable reason so the worker can decide without an LLM.
 */
export function classifyRetry(err: {
  code?: string;
  name?: string;
}): { retryable: boolean; reason: string } {
  if (err.code && RETRYABLE_ERROR_CODES.has(err.code)) {
    return { retryable: true, reason: `transient:${err.code}` };
  }

  // Anything that carries an explicit BAN error code is presumed terminal
  // (fail-fast), unless the code is in the retryable allowlist above.
  if (err.code) {
    return { retryable: false, reason: `do-not-retry:${err.code}` };
  }

  // Unknown / generic errors default to retryable — the worker will mark them
  // FAILED/DEAD_LETTER only once the attempt budget is exhausted.
  return { retryable: true, reason: 'transient:unknown' };
}

// ---------------------------------------------------------------------------
// Deterministic idempotency key helpers
// ---------------------------------------------------------------------------

/** Build a deterministic per-scope idempotency key from a discriminator. */
export function buildIdempotencyKey(scope: string, discriminator: string): string {
  return generateIdempotencyKey(scope, discriminator);
}

// ---------------------------------------------------------------------------
// Internal status helpers used by the worker loop
// ---------------------------------------------------------------------------

export const JOB_STATUSES = JobStatusSchema.options;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Maximum attempts before a job is dead-lettered. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Proof a job is a candidate for DEAD_LETTER once the attempt budget is spent.
 */
export function shouldDeadLetter(attempt: number, maxAttempts: number = DEFAULT_MAX_ATTEMPTS): boolean {
  return attempt >= maxAttempts;
}

// ---------------------------------------------------------------------------
// Dev/test-only failure knobs (never invoked in a production path)
// ---------------------------------------------------------------------------

export type TestFailureMode =
  | { kind: 'none' }
  | { kind: 'retryable'; attempts: number }
  | { kind: 'terminal' };

export const FAILURE_FLAG_KEY = 'AUDIT_ONLY__fail';
export const RETRY_COUNT_KEY = 'AUDIT_ONLY__retries';

/**
 * Resolve the test-failure directive from a payload.
 * M2's "Done when" requires a job that can be intentionally failed/retried/
 * dead-lettered — this provides that deterministic switch keyed off a
 * clearly-labelled dev-only field so it can never fire in a real payload.
 */
export function resolveTestFailure(payload: Record<string, unknown>): TestFailureMode {
  const flag = payload[FAILURE_FLAG_KEY] as string | undefined;
  if (!flag) return { kind: 'none' };

  if (flag === 'retryable') {
    const n = Number(payload[RETRY_COUNT_KEY]);
    return {
      kind: 'retryable',
      attempts: Number.isFinite(n) && n > 0 ? Math.floor(n) : 2,
    };
  }
  if (flag === 'terminal') return { kind: 'terminal' };
  return { kind: 'none' };
}