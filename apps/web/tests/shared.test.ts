import { describe, it, expect } from 'vitest';
import { generateCorrelationId, generateId, BANError, ErrorCode } from '@ban/shared';

describe('BAN shared primitives', () => {
  it('generates a correlation id', () => {
    const id = generateCorrelationId('ban');
    expect(id.startsWith('ban_')).toBe(true);
  });

  it('generates a prefixed id', () => {
    expect(generateId('job').startsWith('job_')).toBe(true);
  });

  it('BANError carries code, retryable and correlationId', () => {
    const err = new BANError(ErrorCode.POLICY_DENIED, 'denied', {
      correlationId: 'ban_abc',
      retryable: false,
    });
    expect(err.code).toBe(ErrorCode.POLICY_DENIED);
    expect(err.retryable).toBe(false);
    expect(err.correlationId).toBe('ban_abc');
  });
});