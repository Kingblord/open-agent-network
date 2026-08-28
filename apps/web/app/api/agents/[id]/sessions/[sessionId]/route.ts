import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { sessionManagerFactory } from '@/lib/session-manager-factory';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.sessions.session');

/**
 * M4 - Single session lifecycle.
 *
 * POST /api/agents/:id/sessions/:sessionId/lifecycle
 *   { action: 'activate' | 'revoke' }  -> drive the session state machine.
 * GET  /api/agents/:id/sessions/:sessionId -> read a session.
 *
 * The SessionManager owns the lifecycle transitions (PENDING -> ACTIVE via
 * register; ACTIVE -> REVOKED via on-chain revoke). Owner-authorized only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }
    const { id, sessionId } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    const manager = sessionManagerFactory();
    const session = await manager.getById(sessionId);
    if (!session || session.agentId !== id) {
      return errorResponse(404, 'Session not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    logger.error('session_fetch_failed', {}, err);
    return handleError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }
    const { id, sessionId } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to manage sessions for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }
    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== 'activate' && action !== 'revoke') {
      return errorResponse(400, 'Unsupported session action; use "activate" or "revoke"', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    const manager = sessionManagerFactory();
    const session = await manager.getById(sessionId);
    if (!session || session.agentId !== id) {
      return errorResponse(404, 'Session not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const updated =
      action === 'activate' ? await manager.registerSession(sessionId) : await manager.revokeSession(sessionId);
    logger.info('session_lifecycle', { sessionId, agentId: id, action, correlationId: getCorrelationId() });
    return NextResponse.json({ ok: true, session: updated });
  } catch (err) {
    logger.error('session_lifecycle_failed', {}, err);
    return handleError(err);
  }
}