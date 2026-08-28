import { describe, it, expect } from 'vitest';
import {
  classifyRetry,
  shouldDeadLetter,
  resolveTestFailure,
  buildIdempotencyKey,
  DEFAULT_MAX_ATTEMPTS,
  FAILURE_FLAG_KEY,
  RETRY_COUNT_KEY,
} from '@/lib/jobs/job-common';
import { ErrorCode } from '@ban/shared';

/**
 * M2 - Durable Job System unit tests.
 *
 * job-common is intentionally free of Firebase/Next.js so these tests run
 * fast and in isolation (see job-common.ts header). They lock in the retry
 * classification policy, the dead-letter threshold, the deterministic
 * idempotency-key helper, and the dev-only failure knobs used to prove the
 * M2 Ended-when loop.
 */

describe('classifyRetry', () => {
  it('treats transient provider errors as retryable', () => {
    const r = classifyRetry({ code: ErrorCode.PROVIDER_UNAVAILABLE });
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe(`transient:${ErrorCode.PROVIDER_UNAVAILABLE}`);
  });

  it('treats RPC timeouts as retryable', () => {
    expect(classifyRetry({ code: ErrorCode.RPC_TIMEOUT }).retryable).toBe(true);
  });

  it('does not retry an explicit BAN code that is not transient', () => {
    const r = classifyRetry({ code: ErrorCode.POLICY_DENIED });
    expect(r.retryable).toBe(false);
    expect(r.reason).toContain('do-not-retry');
  });

  it('defaults unknown/generic errors to retryable', () => {
    const r = classifyRetry({ name: 'SomeSystemError' });
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('transient:unknown');
  });
});

describe('shouldDeadLetter', () => {
  it('dead-letters when the attempt budget is exhausted', () => {
    expect(shouldDeadLetter(DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS)).toBe(true);
  });

  it('does not dead-letter before the budget is spent', () => {
    expect(shouldDeadLetter(1, DEFAULT_MAX_ATTEMPTS)).toBe(false);
  });

  it('honours a custom max attempts budget', () => {
    expect(shouldDeadLetter(2, 2)).toBe(true);
    expect(shouldDeadLetter(1, 2)).toBe(false);
  });
});

describe('buildIdempotencyKey', () => {
  it('produces a deterministic, prefixed key for the same scope+discriminator', () => {
    const a = buildIdempotencyKey('execution', 'agent_1:order_42');
    const b = buildIdempotencyKey('execution', 'agent_1:order_42');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('varies with the discriminator', () => {
    expect(buildIdempotencyKey('execution', 'agent_1:order_42')).not.toBe(
      buildIdempotencyKey('execution', 'agent_1:order_43')
    );
  });
});

describe('resolveTestFailure (dev-only knobs)', () => {
  it('returns none when no failure flag is set', () => {
    expect(resolveTestFailure({})).toEqual({ kind: 'none' });
  });

  it('recognises the terminal directive', () => {
    expect(resolveTestFailure({ [FAILURE_FLAG_KEY]: 'terminal' })).toEqual({ kind: 'terminal' });
  });

  it('parses a retryable directive with an attempt count', () => {
    const r = resolveTestFailure({ [FAILURE_FLAG_KEY]: 'retryable', [RETRY_COUNT_KEY]: 2 });
    expect(r).toEqual({ kind: 'retryable', attempts: 2 });
  });

  it('defaults an invalid/garbage retry count to 2', () => {
    const r = resolveTestFailure({ [FAILURE_FLAG_KEY]: 'retryable', [RETRY_COUNT_KEY]: 'not-a-number' });
    expect(r).toEqual({ kind: 'retryable', attempts: 2 });
  });
});