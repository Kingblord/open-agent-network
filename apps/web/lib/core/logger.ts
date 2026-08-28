import { getCorrelationId } from './request-context';

// BAN structured logger bound to the request correlation context.
// Logs are emitted as single JSON lines so they can be consumed by Vercel/Inngest.

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  correlationId?: string;
  agentId?: string;
  proposalId?: string;
  jobId?: string;
  executionId?: string;
  transactionHash?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, scope: string, message: string, context?: LogContext, error?: unknown) {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    correlationId: context?.correlationId ?? getCorrelationId(),
    ...(context ?? {}),
  };
  if (error) {
    entry.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
  }
  const line = JSON.stringify(entry);
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

export function createStructuredLogger(scope: string) {
  return {
    info: (message: string, context?: LogContext) => write('info', scope, message, context),
    warn: (message: string, context?: LogContext) => write('warn', scope, message, context),
    error: (message: string, context?: LogContext, error?: unknown) => write('error', scope, message, context, error),
    debug: (message: string, context?: LogContext) => write('debug', scope, message, context),
  };
}

export type StructuredLogger = ReturnType<typeof createStructuredLogger>;