import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { errorResponse } from '@/lib/core/errors';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { ErrorCode } from '@ban/shared';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/summary
 *
 * ONE round-trip that returns everything the dashboard needs, with FIRESTORE
 * QUOTA-bounded reads. Before this route, the dashboard polled per-agent
 * performance (150 exec + 50 pos reads each), per-agent activity (2×100), and
 * per-agent balance (1 agent read each) — with 4 agents that fan-out burned
 * ~30k reads/hour against the 20k/day quota.
 *
 * Reads per call (independent of agent count):
 *   - 1 × agents query (owner)
 *   - 1 × executions  where agentId in [ids] limit 200
 *   - 1 × positions   where agentId in [ids] limit 100
 *   - 1 × auditEvents where userId == owner limit 50 (activity feed)
 *   = ≤ 4 queries, ≤ ~400 doc reads worst case. Balances are read on-chain
 *     (RPC, zero Firestore reads) and are fetched separately by the client.
 */

const AGENT_IN_LIMIT = 30; // Firestore 'in' supports up to 30 disjunction values

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  const user = token ? verifyToken(token) : null;
  if (!user) {
    return errorResponse(401, 'Unauthorized: missing or invalid token', {
      code: ErrorCode.UNAUTHENTICATED,
      correlationId: '',
    });
  }

  try {
    const db = getAdminDb();

    const agentsSnap = await db
      .collection(collections.agents)
      .where('ownerId', '==', user.developerId)
      .get();

    const agents = agentsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.name as string) || d.id,
        status: (data.status as string) || 'DRAFT',
        strategyId: (data.strategyId as string) || '',
        riskLevel: (data.riskLevel as string) || 'MEDIUM',
        type: (data.type as string) || '',
      };
    });

    const agentIds = agents.map((a) => a.id);
    const idChunks: string[][] = [];
    for (let i = 0; i < agentIds.length; i += AGENT_IN_LIMIT) {
      idChunks.push(agentIds.slice(i, i + AGENT_IN_LIMIT));
    }

    const execQuery = (ids: string[]) =>
      db.collection(collections.executions).where('agentId', 'in', ids).limit(200).get();
    const posQuery = (ids: string[]) =>
      db.collection(collections.positions).where('agentId', 'in', ids).limit(100).get();
    const activityQuery = () =>
      db.collection(collections.auditEvents).where('userId', '==', user.developerId).limit(50).get();

    const [execSnaps, posSnaps, activitySnap] = await Promise.all([
      Promise.all(idChunks.map(execQuery)),
      Promise.all(idChunks.map(posQuery)),
      activityQuery(),
    ]);

    // Aggregate executions per agent (status counts + fee totals only — the
    // heavy per-agent aggregates stay on the per-agent performance endpoint,
    // which the agent detail page still uses).
    const perAgent: Record<
      string,
      { confirmedCount: number; totalTrades: number; feesWei: number; lastExecutedAt: string | null }
    > = {};
    for (const snap of execSnaps) {
      snap.forEach((doc) => {
        const d = doc.data();
        const agentId = (d.agentId as string) || '';
        const bucket = (perAgent[agentId] ??= {
          confirmedCount: 0,
          totalTrades: 0,
          feesWei: 0,
          lastExecutedAt: null,
        });
        bucket.totalTrades += 1;
        if (d.status === 'CONFIRMED') {
          bucket.confirmedCount += 1;
          try {
            bucket.feesWei += Number(d.totalFeesWei ?? d.gasUsed ?? 0) || 0;
          } catch { /* ignore */ }
          const at = (d.confirmedAt as string) || (d.createdAt as string) || '';
          if (at && (!bucket.lastExecutedAt || at > bucket.lastExecutedAt)) {
            bucket.lastExecutedAt = at;
          }
        }
      });
    }

    // Open position values per agent (USD cents strings from the position repo).
    const positionValue: Record<string, number> = {};
    let positionsTotalUsd = 0;
    let hasPositions = false;
    for (const snap of posSnaps) {
      snap.forEach((doc) => {
        const d = doc.data();
        const agentId = (d.agentId as string) || '';
        const current = Number(d.currentValueUsd ?? '0') || 0;
        if (current > 0) {
          positionValue[agentId] = (positionValue[agentId] ?? 0) + current;
          positionsTotalUsd += current;
          hasPositions = true;
        }
      });
    }

    // Latest activity across all owned agents (newest 10, normalized shape the
    // dashboard already renders).
    const activity: Array<{
      id: string;
      agentId: string;
      agentName: string;
      eventType: string;
      severity: string;
      createdAt: string;
      detail: Record<string, unknown>;
    }> = [];
    const nameById = new Map(agents.map((a) => [a.id, a.name]));
    activitySnap.forEach((doc) => {
      const d = doc.data();
      activity.push({
        id: doc.id,
        agentId: (d.agentId as string) || '',
        agentName: nameById.get((d.agentId as string) || '') || '',
        eventType: (d.eventType as string) || (d.type as string) || 'UNKNOWN',
        severity: (d.severity as string) || 'INFO',
        createdAt: (d.createdAt as string) || '',
        detail: (d.detail as Record<string, unknown>) ?? (d.payload as Record<string, unknown>) ?? {},
      });
    });
    activity.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      ok: true,
      agents,
      executions: Object.fromEntries(
        Object.entries(perAgent).map(([id, v]) => [id, v]),
      ),
      positionValueUsdCents: positionValue,
      positionsTotalUsdCents: positionsTotalUsd.toFixed(0),
      hasPositions,
      activity: activity.slice(0, 10),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse(500, 'Failed to load dashboard summary', {
      code: ErrorCode.INTERNAL,
      correlationId: '',
    });
  }
}
