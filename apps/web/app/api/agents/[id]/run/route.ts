import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { runAgentCycle } from '@/lib/agent-runtime/run-cycle';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.run');

/**
 * M18/v2 — POST /api/agents/:id/run
 *
 * Manual "Run cycle now" — a demo/judge trigger that runs ONE complete
 * closed-loop cycle for a deployed agent:
 *
 *   OBSERVE → decide → PROPOSE → POLICY (validate+reserve) → EXECUTE (per-agent
 *   wallet) → POSITION → PERFORMANCE → AUDIT
 *
 * Auth: owner-only (registry enforces ownership; we pre-check for a friendly
 * error instead of a generic 500).
 *
 * This is the manual counterpart to the autonomous Inngest tick (A) — it gives
 * a human operator a safe way to exercise the loop on demand, exactly as M13
 * (manage/activate agents) and the M18 demo require. It never fabricates a
 * receipt: runAgentCycle's honesty contract already guarantees a real
 * transaction hash or an honest "awaiting execution" state.
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
    const actorId = user.developerId;

    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== actorId) {
      return errorResponse(403, 'Not authorized to run this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const correlationId = getCorrelationId();
    const result = await runAgentCycle({
      agentId: agent.id,
      userId: actorId,
      correlationId,
    });

    logger.info('agent_cycle_manual', {
      agentId: agent.id,
      actorId,
      result,
      correlationId,
    });

    return NextResponse.json({
      ok: result.ok,
      result,
      agentStatus: agent.status,
    });
  } catch (err) {
    logger.error('agent_run_failed', {}, err);
    return handleError(err);
  }
}