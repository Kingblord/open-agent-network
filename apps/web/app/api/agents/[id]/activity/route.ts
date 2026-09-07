import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.activity');

/**
 * M14 — GET /api/agents/:id/activity
 *
 * Returns paginated audit + agent events for a given agent, newest first.
 * Authenticated, owner-only access. The activity feed lets a user (or a judge)
 * watch what the agent has done and understand why each event occurred.
 *
 * Event types (M14 specification):
 *   AGENT_ACTIVATED, AGENT_PAUSED, AGENT_REVOKED, OBSERVATION_CREATED,
 *   AI_DECISION_CREATED, ACTION_PROPOSED, ACTION_DENIED, ACTION_APPROVED,
 *   EXECUTION_QUEUED, TRANSACTION_SUBMITTED, TRANSACTION_CONFIRMED,
 *   TRANSACTION_FAILED, POSITION_UPDATED
 *
 * The closed loop:
 *   event → Firestore audit record → structured log → UI activity feed
 */
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
      return errorResponse(403, 'Activity for this agent is only visible to the account that hired it. Hire or deploy it first, or sign in with the account that owns it.', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '50') || 50, 100);
    const startAfter = request.nextUrl.searchParams.get('startAfter') || undefined;

    const db = getAdminDb();

    // Collect from both audit_events and agent_events collections for completeness.
    // agent_events holds lifecycle transitions; audit_events holds runtime events
    // (proposals, executions, transactions, positions).
    // Single-field equality only (no composite orderBy) → no manual Firestore index.
    // FIRESTORE QUOTA: capped at limit (≤100) per collection — the old limit*4
    // (up to 400 docs per collection per poll) drained the 20k/day read quota
    // when combined with client polling.
    const auditQuery = db
      .collection(collections.auditEvents)
      .where('agentId', '==', id)
      .limit(limit);

    const agentEventsQuery = db
      .collection(collections.agentEvents)
      .where('agentId', '==', id)
      .limit(limit);

    const [auditSnap, agentSnap] = await Promise.all([auditQuery.get(), agentEventsQuery.get()]);

    const events: Array<{
      id: string;
      eventType: string;
      agentId: string;
      correlationId: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }> = [];

    auditSnap.forEach((doc) => {
      const data = doc.data();
      events.push({
        id: doc.id,
        eventType: data.eventType ?? data.type ?? 'UNKNOWN',
        agentId: data.agentId ?? id,
        correlationId: data.correlationId ?? '',
        payload: data.payload ?? data.detail ?? {},
        createdAt: data.createdAt ?? doc.createTime?.toDate()?.toISOString() ?? new Date().toISOString(),
      });
    });

    agentSnap.forEach((doc) => {
      const data = doc.data();
      events.push({
        id: doc.id,
        eventType: data.eventType ?? data.type ?? 'AGENT_EVENT',
        agentId: data.agentId ?? id,
        correlationId: data.correlationId ?? '',
        payload: data.payload ?? data.detail ?? {},
        createdAt: data.createdAt ?? doc.createTime?.toDate()?.toISOString() ?? new Date().toISOString(),
      });
    });

    // Merge and sort by createdAt descending (newest first).
    events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply cursor if provided (skip until we find the startAfter id).
    const sliced = startAfter
      ? events.filter((e) => e.id !== startAfter).slice(0, limit)
      : events.slice(0, limit);

    const hasMore = events.length > limit;

    logger.info('activity_fetched', { agentId: id, count: sliced.length, correlationId: getCorrelationId() });
    return NextResponse.json({ ok: true, events: sliced, hasMore });
  } catch (err) {
    logger.error('activity_fetch_failed', {}, err);
    return handleError(err);
  }
}