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

    const mapSnap = (
      snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
      fallbackType: string,
    ): Array<{
      id: string;
      eventType: string;
      severity: string;
      agentId: string;
      agentName: string;
      correlationId: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }> => {
      const out: Array<{
        id: string;
        eventType: string;
        severity: string;
        agentId: string;
        agentName: string;
        correlationId: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }> = [];
      snap.forEach((doc) => {
        const data = doc.data();
        const eventType = data.eventType ?? data.type ?? fallbackType;
        if (filterType && eventType !== filterType) return;
        out.push({
          id: doc.id,
          eventType,
          severity: data.severity ?? 'INFO',
          agentId: data.agentId ?? '',
          agentName: agentNameMap[data.agentId ?? ''] ?? data.agentId ?? '',
          correlationId: data.correlationId ?? '',
          payload: data.payload ?? data.detail ?? {},
          createdAt: data.createdAt ?? doc.createTime?.toDate()?.toISOString() ?? new Date().toISOString(),
        });
      });
      return out;
    };

    // Build agent name map
    const agentNameMap: Record<string, string> = {};
    agentsSnap.docs.forEach((doc) => {
      agentNameMap[doc.id] = doc.data().name ?? doc.id;
    });

    // FIRESTORE QUOTA: query by userId (stored on every audit event at write
    // time) instead of one query PER AGENT per collection. This caps a load at
    // 2 queries × `limit` reads regardless of how many agents the user owns —
    // the previous per-agent fan-out (2 × N agents × 2×limit reads) drained
    // the 20k/day read quota within minutes of a page staying open.
    const [auditSnap, agentSnap] = await Promise.all([
      db.collection(collections.auditEvents).where('userId', '==', user.developerId).limit(limit).get(),
      db.collection(collections.agentEvents).where('userId', '==', user.developerId).limit(limit).get(),
    ]);
    const events = [...mapSnap(auditSnap, 'UNKNOWN'), ...mapSnap(agentSnap, 'AGENT_EVENT')]
      // Keep the single-agent filter honest (userId queries span all agents).
      .filter((e) => !filterAgentId || e.agentId === filterAgentId);

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
