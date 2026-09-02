import { randomUUID } from 'node:crypto';

/**
 * BAN shared primitives: correlation IDs, error taxonomy, structured logger.
 * These are runtime-agnostic (no Next.js/Firebase dependency).
 */

export function generateCorrelationId(prefix = 'ban'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function generateIdempotencyKey(scope: string, discriminator: string): string {
  return `${scope}:${discriminator}`;
}

// ---------------------------------------------------------------------------
// Error taxonomy (basic — extensible as milestones land)
// ---------------------------------------------------------------------------

export enum ErrorCode {
  // Auth / session
  UNAUTHENTICATED = 'ERR_UNAUTHENTICATED',
  FORBIDDEN = 'ERR_FORBIDDEN',
  SESSION_EXPIRED = 'ERR_SESSION_EXPIRED',
  SESSION_REVOKED = 'ERR_SESSION_REVOKED',
  // Policy
  POLICY_DENIED = 'ERR_POLICY_DENIED',
  SPEND_LIMIT_EXCEEDED = 'ERR_SPEND_LIMIT_EXCEEDED',
  CONTRACT_NOT_ALLOWED = 'ERR_CONTRACT_NOT_ALLOWED',
  FUNCTION_NOT_ALLOWED = 'ERR_FUNCTION_NOT_ALLOWED',
  TOKEN_NOT_ALLOWED = 'ERR_TOKEN_NOT_ALLOWED',
  AGENT_INACTIVE = 'ERR_AGENT_INACTIVE',
  // Validation
  VALIDATION_FAILED = 'ERR_VALIDATION_FAILED',
  SCHEMA_INVALID = 'ERR_SCHEMA_INVALID',
  // Execution
  EXECUTION_FAILED = 'ERR_EXECUTION_FAILED',
  TX_REVERTED = 'ERR_TX_REVERTED',
  INSUFFICIENT_BALANCE = 'ERR_INSUFFICIENT_BALANCE',
  SLIPPAGE_VIOLATION = 'ERR_SLIPPAGE_VIOLATION',
  STALE_PRICE = 'ERR_STALE_PRICE',
  // Idempotency
  DUPLICATE_JOB = 'ERR_DUPLICATE_JOB',
  DUPLICATE_PROPOSAL = 'ERR_DUPLICATE_PROPOSAL',
  // Infrastructure
  PROVIDER_UNAVAILABLE = 'ERR_PROVIDER_UNAVAILABLE',
  RPC_TIMEOUT = 'ERR_RPC_TIMEOUT',
  INTERNAL = 'ERR_INTERNAL',
}

export class BANError extends Error {
  readonly code: ErrorCode;
  readonly correlationId?: string;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, opts: { correlationId?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'BANError';
    this.code = code;
    this.correlationId = opts.correlationId;
    this.retryable = opts.retryable ?? false;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      correlationId: this.correlationId,
      retryable: this.retryable,
    };
  }
}

export function isBANError(err: unknown): err is BANError {
  return err instanceof BANError;
}

// ---------------------------------------------------------------------------
// Structured logger interface + default console implementation
// ---------------------------------------------------------------------------

export interface LogContext {
  correlationId?: string;
  agentId?: string;
  proposalId?: string;
  jobId?: string;
  executionId?: string;
  transactionHash?: string;
  [key: string]: unknown;
}

export interface StructuredLogger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext, error?: unknown): void;
  debug(message: string, context?: LogContext): void;
}

export class ConsoleLogger implements StructuredLogger {
  constructor(private readonly scope: string) {}

  private write(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: LogContext, error?: unknown) {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...(context ?? {}),
    };
    if (error) {
      entry.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    }
    const line = JSON.stringify(entry);
    // eslint-disable-next-line no-console
    switch (level) {
      case 'info':
        console.info(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'error':
        console.error(line);
        break;
      case 'debug':
        console.debug(line);
        break;
    }
  }

  info(message: string, context?: LogContext) {
    this.write('info', message, context);
  }
  warn(message: string, context?: LogContext) {
    this.write('warn', message, context);
  }
  error(message: string, context?: LogContext, error?: unknown) {
    this.write('error', message, context, error);
  }
  debug(message: string, context?: LogContext) {
    this.write('debug', message, context);
  }
}

export function createLogger(scope: string): StructuredLogger {
  return new ConsoleLogger(scope);
}

// ---------------------------------------------------------------------------
// Partition / normalization helpers
// ---------------------------------------------------------------------------

export function normalizeError(err: unknown): { name: string; message: string; code?: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: isBANError(err) ? err.code : undefined,
      stack: err.stack,
    };
  }
  return { name: 'UnknownError', message: String(err) };
}