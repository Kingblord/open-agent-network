import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry, type AgentMetadataPatch } from '@/lib/agent-registry';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.id');

/**
 * M3 - GET /api/agents/:id -> fetch a single agent (the authoritative record).
 *
 * Public discovery. Marketplace browsing (list) and single-agent detail are
 * public reads of ACTIVE agents; sign-in is only required to hire/deploy/
 * activate (an action, not a read). For public reads we strip owner/internal
 * fields the same way the list route does.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // The registry is authoritative; return it as-is so the caller can never
    // confuse a stale marketplace cache with the live record.
    logger.info('agent_fetched', { agentId: agent.id, ownerId: agent.ownerId });
    return NextResponse.json({ ok: true, agent });
  } catch (err) {
    logger.error('agent_fetch_failed', {}, err);
    return handleError(err);
  }
}

/**
 * M3 - PATCH /api/agents/:id -> update metadata ONLY.
 *
 * Lifecycle status is intentionally immutable here — that is exclusively the
 * lifecycle endpoint's job (POST /agents/:id/lifecycle). Owner and wallet are
 * also immutable. Requires authentication (a mutating action).
 */
export async function PATCH(
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
    const body = await request.json().catch(() => null);

    // Reject any attempt to smuggle a status change through the metadata path.
    if (body && typeof body === 'object' && 'status' in body) {
      return errorResponse(400, 'Cannot change lifecycle status via PATCH; use POST /agents/:id/lifecycle', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const updated = await agentRegistry.updateMetadata(id, body as AgentMetadataPatch, user.developerId);
    if (!updated) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    return NextResponse.json({ ok: true, agent: updated });
  } catch (err) {
    logger.error('agent_metadata_update_failed', {}, err);
    return handleError(err);
  }
}