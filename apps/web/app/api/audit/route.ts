import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.audit');

/**
 * M14 — GET /api/audit
 *
 * Returns paginated audit + agent events for ALL agents owned by the
 * authenticated user, newest first. This is the global audit trail that
 * lets a user (or a judge) watch every agent's behavior and understand
 * why each event occurred.
 *
 * Query params:
 *   limit      — max events per page (default 50, max 200)
 *   startAfter — cursor for pagination
 *   agentId    — filter to a specific agent (optional)
 *   type       — filter by event type (optional)
 *
 * Event types (M14 specification):
 *   AGENT_ACTIVATED, AGENT_PAUSED, AGENT_REVOKED, OBSERVATION_CREATED,
 *   AI_DECISION_CREATED, ACTION_PROPOSED, ACTION_DENIED, ACTION_APPROVED,
 *   EXECUTION_QUEUED, TRANSACTION_SUBMITTED, TRANSACTION_CONFIRMED,
 *   TRANSACTION_FAILED, POSITION_UPDATED
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }

    const limit = Math.min(
      Number(request.nextUrl.searchParams.get('limit') ?? '50') || 50,
      200
    );
    const startAfter = request.nextUrl.searchParams.get('startAfter') || undefined;
    const filterAgentId = request.nextUrl.searchParams.get('agentId') || undefined;
    const filterType = request.nextUrl.searchParams.get('type') || undefined;

    const db = getAdminDb();

    // Get all agents owned by this user
    const agentsSnap = await db
      .collection(collections.agents)
      .where('ownerId', '==', user.developerId)
      .get();

    const agentIds = agentsSnap.docs.map((d) => d.id);

    // If filtering to a specific agent, verify ownership
    if (filterAgentId) {
      if (!agentIds.includes(filterAgentId)) {
        return errorResponse(403, 'Access denied: you do not own this agent', {
          code: ErrorCode.POLICY_DENIED,
          correlationId: getCorrelationId(),
        });
      }
    }

    const targetAgentIds = filterAgentId ? [filterAgentId] : agentIds;

    if (targetAgentIds.length === 0) {
      return NextResponse.json({ ok: true, events: [], hasMore: false });
    }

    // Collect from both audit_events and agent_events collections
    // Firestore single-field equality only — query each agent separately
    const events: Array<{
      id: string;
      eventType: string;
      severity: string;
      agentId: string;
      agentName: string;
      correlationId: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }> = [];

    // Build agent name map
    const agentNameMap: Record<string, string> = {};
    agentsSnap.docs.forEach((doc) => {
      agentNameMap[doc.id] = doc.data().name ?? doc.id;
    });

    // Query audit_events for each target agent (Firestore single-field equality)
    const auditPromises = targetAgentIds.map(async (agentId) => {
      const snap = await db
        .collection(collections.auditEvents)
        .where('agentId', '==', agentId)
        .limit(limit * 2)
        .get();
      snap.forEach((doc) => {
        const data = doc.data();
        const eventType = data.eventType ?? data.type ?? 'UNKNOWN';
        if (filterType && eventType !== filterType) return;
        events.push({
          id: doc.id,
          eventType,
          severity: data.severity ?? 'INFO',
          agentId: data.agentId ?? agentId,
          agentName: agentNameMap[data.agentId ?? agentId] ?? agentId,
          correlationId: data.correlationId ?? '',
          payload: data.payload ?? data.detail ?? {},
          createdAt: data.createdAt ?? doc.createTime?.toDate()?.toISOString() ?? new Date().toISOString(),
        });
      });
    });

    const agentEventPromises = targetAgentIds.map(async (agentId) => {
      const snap = await db
        .collection(collections.agentEvents)
        .where('agentId', '==', agentId)
        .limit(limit * 2)
        .get();
      snap.forEach((doc) => {
        const data = doc.data();
        const eventType = data.eventType ?? data.type ?? 'AGENT_EVENT';
        if (filterType && eventType !== filterType) return;
        events.push({
          id: doc.id,
          eventType,
          severity: data.severity ?? 'INFO',
          agentId: data.agentId ?? agentId,
          agentName: agentNameMap[data.agentId ?? agentId] ?? agentId,
          correlationId: data.correlationId ?? '',
          payload: data.payload ?? data.detail ?? {},
          createdAt: data.createdAt ?? doc.createTime?.toDate()?.toISOString() ?? new Date().toISOString(),
        });
      });
    });

    await Promise.all([...auditPromises, ...agentEventPromises]);

    // Sort by createdAt descending (newest first)
    events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply cursor pagination
    const sliced = startAfter
      ? events.filter((e) => e.id !== startAfter).slice(0, limit)
      : events.slice(0, limit);

    const hasMore = events.length > limit;

    logger.info('audit_fetched', {
      userId: user.developerId,
      agentCount: targetAgentIds.length,
      eventCount: sliced.length,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({ ok: true, events: sliced, hasMore });
  } catch (err) {
    logger.error('audit_fetch_failed', {}, err);
    return handleError(err);
  }
}
