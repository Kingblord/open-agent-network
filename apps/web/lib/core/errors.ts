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

/**
 * Maps BANError codes to HTTP statuses.
 *
 * Registry/lookup failures (unknown or unverified contracts/tokens, spend-cap
 * rejections) are CLIENT errors (422/403), never 500s: the UI offers
 * recognized-but-unverified options and must get a user-facing response so it
 * can grey them out, not a crash. 500 stays reserved for genuinely unexpected
 * failures (Firestore down, RPC timeouts, internal bugs).
 */
export function handleError(err: unknown, fallbackStatus = 500): NextResponse<ApiErrorBody> {
  if (err instanceof BANError) {
    const status =
      err.code === 'ERR_UNAUTHENTICATED' || err.code === 'ERR_SESSION_EXPIRED' || err.code === 'ERR_SESSION_REVOKED'
        ? 401
        : err.code === 'ERR_POLICY_DENIED'
          ? 403
          : err.code === 'ERR_CONTRACT_NOT_ALLOWED' ||
              err.code === 'ERR_TOKEN_NOT_ALLOWED' ||
              err.code === 'ERR_SPEND_LIMIT_EXCEEDED'
            ? 422
            : err.code?.startsWith('ERR_VALIDATION') || err.code === 'ERR_SCHEMA_INVALID'
              ? 400
              : fallbackStatus;
    return errorResponse(status, err.message, { code: err.code, correlationId: err.correlationId });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return errorResponse(fallbackStatus, message);
}