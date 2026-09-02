import { randomUUID } from 'node:crypto';
/**
 * BAN shared primitives: correlation IDs, error taxonomy, structured logger.
 * These are runtime-agnostic (no Next.js/Firebase dependency).
 */
export function generateCorrelationId(prefix = 'ban') {
    return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
export function generateId(prefix) {
    return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
export function generateIdempotencyKey(scope, discriminator) {
    return `${scope}:${discriminator}`;
}
// ---------------------------------------------------------------------------
// Error taxonomy (basic — extensible as milestones land)
// ---------------------------------------------------------------------------
export var ErrorCode;
(function (ErrorCode) {
    // Auth / session
    ErrorCode["UNAUTHENTICATED"] = "ERR_UNAUTHENTICATED";
    ErrorCode["FORBIDDEN"] = "ERR_FORBIDDEN";
    ErrorCode["SESSION_EXPIRED"] = "ERR_SESSION_EXPIRED";
    ErrorCode["SESSION_REVOKED"] = "ERR_SESSION_REVOKED";
    // Policy
    ErrorCode["POLICY_DENIED"] = "ERR_POLICY_DENIED";
    ErrorCode["SPEND_LIMIT_EXCEEDED"] = "ERR_SPEND_LIMIT_EXCEEDED";
    ErrorCode["CONTRACT_NOT_ALLOWED"] = "ERR_CONTRACT_NOT_ALLOWED";
    ErrorCode["FUNCTION_NOT_ALLOWED"] = "ERR_FUNCTION_NOT_ALLOWED";
    ErrorCode["TOKEN_NOT_ALLOWED"] = "ERR_TOKEN_NOT_ALLOWED";
    ErrorCode["AGENT_INACTIVE"] = "ERR_AGENT_INACTIVE";
    // Validation
    ErrorCode["VALIDATION_FAILED"] = "ERR_VALIDATION_FAILED";
    ErrorCode["SCHEMA_INVALID"] = "ERR_SCHEMA_INVALID";
    // Execution
    ErrorCode["EXECUTION_FAILED"] = "ERR_EXECUTION_FAILED";
    ErrorCode["TX_REVERTED"] = "ERR_TX_REVERTED";
    ErrorCode["INSUFFICIENT_BALANCE"] = "ERR_INSUFFICIENT_BALANCE";
    ErrorCode["SLIPPAGE_VIOLATION"] = "ERR_SLIPPAGE_VIOLATION";
    ErrorCode["STALE_PRICE"] = "ERR_STALE_PRICE";
    // Idempotency
    ErrorCode["DUPLICATE_JOB"] = "ERR_DUPLICATE_JOB";
    ErrorCode["DUPLICATE_PROPOSAL"] = "ERR_DUPLICATE_PROPOSAL";
    // Infrastructure
    ErrorCode["PROVIDER_UNAVAILABLE"] = "ERR_PROVIDER_UNAVAILABLE";
    ErrorCode["RPC_TIMEOUT"] = "ERR_RPC_TIMEOUT";
    ErrorCode["INTERNAL"] = "ERR_INTERNAL";
})(ErrorCode || (ErrorCode = {}));
export class BANError extends Error {
    code;
    correlationId;
    retryable;
    constructor(code, message, opts = {}) {
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
export function isBANError(err) {
    return err instanceof BANError;
}
export class ConsoleLogger {
    scope;
    constructor(scope) {
        this.scope = scope;
    }
    write(level, message, context, error) {
        const entry = {
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
    info(message, context) {
        this.write('info', message, context);
    }
    warn(message, context) {
        this.write('warn', message, context);
    }
    error(message, context, error) {
        this.write('error', message, context, error);
    }
    debug(message, context) {
        this.write('debug', message, context);
    }
}
export function createLogger(scope) {
    return new ConsoleLogger(scope);
}
// ---------------------------------------------------------------------------
// Partition / normalization helpers
// ---------------------------------------------------------------------------
export function normalizeError(err) {
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
