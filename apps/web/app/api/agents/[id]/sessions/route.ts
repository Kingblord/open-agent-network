import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { sessionManagerFactory } from '@/lib/session-manager-factory';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.sessions');

/**
 * M4 - Session collection under an agent.
 *
 * POST /api/agents/:id/sessions  -> create a scoped, PENDING session.
 * GET  /api/agents/:id/sessions  -> list sessions for an agent.
 *
 * Requires an authenticated developer, and the agent must be owned by the
 * caller. The SessionManager (via the factory) owns the session records.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to create sessions for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return errorResponse(400, 'Invalid JSON body', {
        code: ErrorCode.SCHEMA_INVALID,
        correlationId: getCorrelationId(),
      });
    }

    const manager = sessionManagerFactory();
    const session = await manager.create({
      agentId: id,
      walletAddress: body.walletAddress,
      allowedContracts: body.allowedContracts ?? [],
      allowedFunctions: body.allowedFunctions ?? [],
      allowedTokens: body.allowedTokens ?? [],
      spendCap: body.spendCap ?? '0',
      perTransactionCap: body.perTransactionCap ?? '0',
      expiresAtMs: body.expiresAtMs,
    });

    logger.info('session_created_via_api', {
      agentId: id,
      sessionId: session.sessionId,
      correlationId: getCorrelationId(),
    });
    return NextResponse.json({ ok: true, session }, { status: 201 });
  } catch (err) {
    logger.error('session_create_failed', {}, err);
    return handleError(err);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to list sessions for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const manager = sessionManagerFactory();
    const sessions = await manager.listByAgent(id);

    logger.info('sessions_listed', { agentId: id, count: sessions.length });
    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    logger.error('sessions_list_failed', {}, err);
    return handleError(err);
  }
}