import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { runAgentCycle } from '@/lib/agent-runtime/run-cycle';
import { loadTaskConfig } from '@/lib/agent-runtime/task-config';
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
    // Retry-through-path: read the taskId from the body when a task card's
    // RETRY is used, so the cycle runs with THAT task's user-configured
    // strategy params (grid bounds, pool address, caps) — not hermetic
    // defaults and not merely the newest task.
    const body = await request.json().catch(() => null);
    const retryTaskId = body && typeof body === 'object' && typeof (body as { taskId?: unknown }).taskId === 'string'
      ? (body as { taskId: string }).taskId
      : undefined;
    const strategyConfig = await loadTaskConfig(agent.id, retryTaskId);
    const result = await runAgentCycle({
      agentId: agent.id,
      userId: actorId,
      correlationId,
      strategyConfig,
    });

    // Kick the self-sustaining Inngest loop (ban/agent.tick-loop) so a manual
    // RUN is never a dead end: when the cycle stopped at an honest `awaited`
    // (e.g. a transient relay hiccup), the loop re-runs it every ~2 min until
    // it resolves or the agent pauses. Same kick the tasks route does.
    // Sets the honest flag so the UI can show whether the loop will continue.
    let loopKicked = false;
    try {
      const { inngest } = await import('@/inngest/client');
      await inngest.send({
        name: 'ban/agent.tick-loop',
        data: {
          agentId: agent.id,
          userId: actorId,
          correlationId,
        },
      });
      loopKicked = true;
      logger.info('run_loop_kicked', { agentId: agent.id, actorId, correlationId });
    } catch (loopErr) {
      logger.warn('run_loop_kick_failed', {
        agentId: agent.id,
        correlationId,
        err: loopErr instanceof Error ? loopErr.message : String(loopErr),
      });
    }

    // Loop-state heartbeat: surface when the Inngest loop last ticked for this
    // agent (absent doc = loop never ran / local dev without Inngest serving).
    let loopState: Record<string, unknown> | null = null;
    try {
      const { getAdminDb } = await import('@/lib/firebase-admin');
      const snap = await getAdminDb().collection('agent_loop_state').doc(agent.id).get();
      if (snap.exists) loopState = snap.data() as Record<string, unknown>;
    } catch {
      loopState = null; // best-effort — never fail the run response
    }

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
      // Honest kick status so callers know whether the autonomous loop is
      // actually scheduled to continue (e.g. local dev without Inngest Dev
      // Server tunneled to Cloud CANNOT deliver the event — surfaced here).
      loopKicked,
      // Liveness of the self-chaining loop, when it has ticked at all.
      loopState,
    });
  } catch (err) {
    logger.error('agent_run_failed', {}, err);
    return handleError(err);
  }
}