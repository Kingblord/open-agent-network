import { NextRequest, NextResponse } from 'next/server';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { getAdminDb, collections } from '@/lib/firebase-admin';

const logger = createStructuredLogger('api.reputation');

/**
 * M15 — GET /api/reputation
 *
 * Computes and returns reputation scores for all agents (or a specific agent).
 *
 * Reputation formula (deterministic):
 *   score = (successRate * 40) + (executionCount_normalized * 25) +
 *           (pnlScore * 20) + (uptimeScore * 15)
 *
 * Where:
 *   - successRate = confirmed / (confirmed + failed), 0–1
 *   - executionCount_normalized = min(executionCount / 50, 1)  (capped at 50)
 *   - pnlScore = sign(pnl) * min(|pnl| / 1000, 1)  (capped at $1000)
 *   - uptimeScore = 1 if agent is ACTIVE, 0.5 if PAUSED, 0 otherwise
 *
 * Score range: 0–100
 *
 * Public endpoint (no auth required) — marketplace display data.
 */
export async function GET(request: NextRequest) {
  try {
    const agentId = request.nextUrl.searchParams.get('agentId') || undefined;
    const db = getAdminDb();

    // Get agents
    let agentsSnap;
    if (agentId) {
      const doc = await db.collection(collections.agents).doc(agentId).get();
      if (!doc.exists) {
        return NextResponse.json({ ok: true, reputations: [] });
      }
      agentsSnap = { docs: [doc] };
    } else {
      agentsSnap = await db.collection(collections.agents).limit(100).get();
    }

    const reputations: Array<{
      agentId: string;
      agentName: string;
      score: number;
      rank: number;
      metrics: {
        successRate: number;
        executionCount: number;
        pnlUsd: number;
        uptimeScore: number;
        breakdown: {
          successComponent: number;
          volumeComponent: number;
          pnlComponent: number;
          uptimeComponent: number;
        };
      };
    }> = [];

    // Compute reputation for each agent
    for (const agentDoc of agentsSnap.docs) {
      const agentId = agentDoc.id;
      const agentData = agentDoc.data() ?? {};
      const agentName = agentData.name ?? agentId;

      // Get performance record
      const perfSnap = await db
        .collection(collections.performance)
        .where('agentId', '==', agentId)
        .limit(1)
        .get();

      const perf = perfSnap.docs[0]?.data();

      // Get execution counts
      const execSnap = await db
        .collection(collections.executions)
        .where('agentId', '==', agentId)
        .limit(100)
        .get();

      const executions = execSnap.docs.map((d) => d.data());
      const confirmedCount = executions.filter((e) => e.status === 'CONFIRMED').length;
      const failedCount = executions.filter((e) => e.status === 'FAILED').length;
      const totalCount = confirmedCount + failedCount;

      // Compute components
      const successRate = totalCount > 0 ? confirmedCount / totalCount : 0;
      const executionCountNorm = Math.min(totalCount / 50, 1);

      // PnL from performance record
      const pnlUsd = perf?.realizedPnlUsd ? parseFloat(perf.realizedPnlUsd) : 0;
      const pnlScore = pnlUsd === 0 ? 0.5 : Math.sign(pnlUsd) * Math.min(Math.abs(pnlUsd) / 1000, 1);

      // Uptime score based on agent status
      const uptimeScore = agentData.status === 'ACTIVE' ? 1 : agentData.status === 'PAUSED' ? 0.5 : 0;

      // Weighted score (0–100)
      const score = Math.round(
        successRate * 40 +
        executionCountNorm * 25 +
        Math.max(pnlScore, 0) * 20 +
        uptimeScore * 15
      );

      reputations.push({
        agentId,
        agentName,
        score,
        rank: 0, // will be set after sorting
        metrics: {
          successRate: Math.round(successRate * 100) / 100,
          executionCount: totalCount,
          pnlUsd: Math.round(pnlUsd * 100) / 100,
          uptimeScore,
          breakdown: {
            successComponent: Math.round(successRate * 40 * 10) / 10,
            volumeComponent: Math.round(executionCountNorm * 25 * 10) / 10,
            pnlComponent: Math.round(Math.max(pnlScore, 0) * 20 * 10) / 10,
            uptimeComponent: Math.round(uptimeScore * 15 * 10) / 10,
          },
        },
      });
    }

    // Sort by score descending and assign ranks
    reputations.sort((a, b) => b.score - a.score);
    reputations.forEach((r, i) => { r.rank = i + 1; });

    logger.info('reputation_computed', {
      count: reputations.length,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({ ok: true, reputations });
  } catch (err) {
    logger.error('reputation_computation_failed', {}, err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
