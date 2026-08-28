import { NextRequest, NextResponse } from 'next/server';
import { correlationMiddleware } from '@/lib/core/request-context';

/**
 * BAN control-plane middleware.
 * Currently assigns a correlation ID to every request (non-breaking).
 * Future: Firebase App Check + route protection can extend this matcher.
 */
export function middleware(request: NextRequest): NextResponse | Promise<NextResponse> {
  return correlationMiddleware(request);
}

export const config = {
  matcher: ['/api/:path*'],
};