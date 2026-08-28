import { NextRequest, NextResponse } from 'next/server';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { ErrorCode } from '@ban/shared';
import { PerformanceCalculator, classifyExecutionMode } from '@ban/performance-engine';

const logger = createStructuredLogger('api.agents.performance');
const calculator = new PerformanceCalculator();

/**
 * GET /api/agents/[id]/performance
 *
 * Public read. Returns aggregated execution-performance metrics for an agent from
 * Firestore, computed via @ban/performance-engine (deterministic, framework-agnostic).
 *
 * Includes operational metrics (trades, success rate, fees, gas, timing),
 * position-based PnL (only when valid Position records exist — never fabricated),
 * capital managed (estimated), and LIVE/TESTNET/SIMULATED mode classification.
 *
 * No fabricated values: summary is computed only from real Execution/Position docs.
 */
const sortByCreatedDesc = (docs: { createdAt?: unknown }[]) =>
  docs.slice().sort((a, b) => {
    const ta = new Date((a.createdAt as string) || 0).getTime();
    const tb = new Date((b.createdAt as string) || 0).getTime();
    return tb - ta;
  });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getAdminDb();

    // Fetch agent for chainId detection
    const agentDoc = await db.collection(collections.agents).doc(id).get();
    const agentData = agentDoc.data();
    const chainId = agentData?.chainId ? Number(agentData.chainId) : null;

    // Fetch executions (last 500). Single-field equality only — no composite
    // orderBy, so no manual Firestore index is required. Sort in-memory below.
    const execSnap = await db
      .collection(collections.executions)
      .where('agentId', '==', id)
      .limit(500)
      .get();

    const executions = sortByCreatedDesc(
      execSnap.docs.map((d) => d.data() as { createdAt: unknown })
    ) as any[];

    // Fetch position records if they exist
    const posSnap = await db
      .collection(collections.positions)
      .where('agentId', '==', id)
      .limit(100)
      .get();

    const positions = posSnap.docs.map((d) => ({
      ...d.data(),
      positionId: d.id,
    })) as any[];

    // Use the deterministic calculator to aggregate
    const summary = calculator.summarize(executions, positions);
    const modeResult = classifyExecutionMode(chainId, summary.confirmedCount);

    logger.info('performance_fetched', {
      agentId: id,
      totalTrades: summary.totalTrades,
      mode: modeResult.mode,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({
      performance: {
        agentId: id,
        ...summary,
        mode: modeResult.mode,
        modeReason: modeResult.reason,
      },
    });
  } catch (err) {
    logger.error('performance_fetch_failed', {}, err);
    return handleError(err);
  }
}