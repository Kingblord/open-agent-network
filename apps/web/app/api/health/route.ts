import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { handleError } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';

/**
 * BAN authenticated health endpoint.
 * Milestone 1 closed loop: user signs in -> verified identity -> Firestore user
 * exists -> authenticated API request succeeds -> structured log emitted.
 */
export async function GET(request: NextRequest) {
  const logger = createStructuredLogger('api.health');
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    const authenticated = Boolean(user);

    if (!authenticated) {
      return NextResponse.json(
        { ok: false, authenticated: false, service: 'ban-control-plane', ts: new Date().toISOString() },
        { status: 401 }
      );
    }

    logger.info('health_check', {
      developerId: user?.developerId,
      route: '/api/health',
    });

    return NextResponse.json({
      ok: true,
      authenticated: true,
      service: 'ban-control-plane',
      developerId: user!.developerId,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('health_check_failed', {}, err);
    return handleError(err);
  }
}