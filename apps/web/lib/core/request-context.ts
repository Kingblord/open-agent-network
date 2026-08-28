import { NextRequest, NextResponse } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';

// Request-scoped correlation context (Node AsyncLocalStorage)
export interface RequestContext {
  correlationId: string;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Edge-runtime-safe UUID v4 generator.
 * Avoids importing `node:crypto` (unsupported in Edge Middleware) by using the
 * global Web Crypto `crypto.randomUUID` when present, with a `Math.random`
 * fallback for runtimes without Web Crypto.
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Set version (4) and variant (RFC 4122) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

export function getCorrelationId(): string {
  return getRequestContext()?.correlationId ?? `uncontextualized_${generateId()}`;
}

export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestStorage.run(context, fn);
}

export const CORRELATION_HEADER = 'x-correlation-id';

export async function correlationMiddleware(request: NextRequest): Promise<NextResponse> {
  const incoming = request.headers.get(CORRELATION_HEADER);
  const correlationId =
    incoming?.trim() || `ban_${generateId().replace(/-/g, '').slice(0, 24)}`;
  const context: RequestContext = { correlationId };

  return withRequestContext(context, () => {
    const response = NextResponse.next();
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  });
}