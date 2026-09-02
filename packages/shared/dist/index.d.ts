/**
 * BAN shared primitives: correlation IDs, error taxonomy, structured logger.
 * These are runtime-agnostic (no Next.js/Firebase dependency).
 */
export declare function generateCorrelationId(prefix?: string): string;
export declare function generateId(prefix: string): string;
export declare function generateIdempotencyKey(scope: string, discriminator: string): string;
export declare enum ErrorCode {
    UNAUTHENTICATED = "ERR_UNAUTHENTICATED",
    FORBIDDEN = "ERR_FORBIDDEN",
    SESSION_EXPIRED = "ERR_SESSION_EXPIRED",
    SESSION_REVOKED = "ERR_SESSION_REVOKED",
    POLICY_DENIED = "ERR_POLICY_DENIED",
    SPEND_LIMIT_EXCEEDED = "ERR_SPEND_LIMIT_EXCEEDED",
    CONTRACT_NOT_ALLOWED = "ERR_CONTRACT_NOT_ALLOWED",
    FUNCTION_NOT_ALLOWED = "ERR_FUNCTION_NOT_ALLOWED",
    TOKEN_NOT_ALLOWED = "ERR_TOKEN_NOT_ALLOWED",
    AGENT_INACTIVE = "ERR_AGENT_INACTIVE",
    VALIDATION_FAILED = "ERR_VALIDATION_FAILED",
    SCHEMA_INVALID = "ERR_SCHEMA_INVALID",
    EXECUTION_FAILED = "ERR_EXECUTION_FAILED",
    TX_REVERTED = "ERR_TX_REVERTED",
    INSUFFICIENT_BALANCE = "ERR_INSUFFICIENT_BALANCE",
    SLIPPAGE_VIOLATION = "ERR_SLIPPAGE_VIOLATION",
    STALE_PRICE = "ERR_STALE_PRICE",
    DUPLICATE_JOB = "ERR_DUPLICATE_JOB",
    DUPLICATE_PROPOSAL = "ERR_DUPLICATE_PROPOSAL",
    PROVIDER_UNAVAILABLE = "ERR_PROVIDER_UNAVAILABLE",
    RPC_TIMEOUT = "ERR_RPC_TIMEOUT",
    INTERNAL = "ERR_INTERNAL"
}
export declare class BANError extends Error {
    readonly code: ErrorCode;
    readonly correlationId?: string;
    readonly retryable: boolean;
    constructor(code: ErrorCode, message: string, opts?: {
        correlationId?: string;
        retryable?: boolean;
        cause?: unknown;
    });
    toJSON(): {
        name: string;
        code: ErrorCode;
        message: string;
        correlationId: string | undefined;
        retryable: boolean;
    };
}
export declare function isBANError(err: unknown): err is BANError;
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
export declare class ConsoleLogger implements StructuredLogger {
    private readonly scope;
    constructor(scope: string);
    private write;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext, error?: unknown): void;
    debug(message: string, context?: LogContext): void;
}
export declare function createLogger(scope: string): StructuredLogger;
export declare function normalizeError(err: unknown): {
    name: string;
    message: string;
    code?: string;
    stack?: string;
};
//# sourceMappingURL=index.d.ts.map