import { NextResponse } from 'next/server';
import { BANError } from '@ban/shared';

// BAN API error responses. All control-plane routes should throw/return
// these shapes so the frontend can map machine-readable errors.

export interface ApiErrorBody {
  error: string;
  code?: string;
  correlationId?: string;
}

export function errorResponse(
  status: number,
  message: string,
  opts: { code?: string; correlationId?: string } = {}
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      error: message,
      ...(opts.code ? { code: opts.code } : {}),
      ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    },
    { status }
  );
}

export function handleError(err: unknown, fallbackStatus = 500): NextResponse<ApiErrorBody> {
  if (err instanceof BANError) {
    const status =
      err.code === 'ERR_UNAUTHENTICATED' || err.code === 'ERR_SESSION_EXPIRED' || err.code === 'ERR_SESSION_REVOKED'
        ? 401
        : err.code === 'ERR_POLICY_DENIED'
          ? 403
          : err.code?.startsWith('ERR_VALIDATION') || err.code === 'ERR_SCHEMA_INVALID'
            ? 400
            : fallbackStatus;
    return errorResponse(status, err.message, { code: err.code, correlationId: err.correlationId });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return errorResponse(fallbackStatus, message);
}