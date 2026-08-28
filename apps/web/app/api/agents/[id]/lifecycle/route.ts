import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry, isLifecycleAction, type LifecycleAction } from '@/lib/agent-registry';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.lifecycle');

const LifecycleBodySchema = z.object({
  action: z.string().min(1),
});

/**
 * M3 - POST /api/agents/:id/lifecycle
 *
 * Body: { "action": "activate" | "pause" | "revoke" }
 *
 * The server-side state machine (AgentRegistry.lifecycle) validates:
 *   1. authorization (actor must be the owning developer)
 *   2. current state -> valid transition
 *   3. wallet/session readiness
 *   4. required capabilities / strategy binding
 *   5. valid transition
 *
 * REVOKED is terminal. Every successful transition emits an audit event.
 *
 * PATCH /:id is for metadata only — lifecycle access is exclusively here.
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

    const body = await request.json().catch(() => null);
    const parsed = LifecycleBodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, 'Invalid lifecycle request: ' + parsed.error.message, {
        code: ErrorCode.SCHEMA_INVALID,
        correlationId: getCorrelationId(),
      });
    }

    const action: unknown = parsed.data.action;
    if (!isLifecycleAction(action)) {
      return errorResponse(400, `Unsupported lifecycle action "${String(action)}"`, {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const updated = await agentRegistry.lifecycle(id, action as LifecycleAction, user.developerId);

    logger.info('agent_lifecycle_via_api', {
      agentId: id,
      action,
      status: updated.status,
      actorId: user.developerId,
    });

    return NextResponse.json({ ok: true, agent: updated });
  } catch (err) {
    logger.error('lifecycle_failed', {}, err);
    return handleError(err);
  }
}