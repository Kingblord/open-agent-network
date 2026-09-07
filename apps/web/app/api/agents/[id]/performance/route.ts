import { NextRequest, NextResponse } from 'next/server';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { getAgentWalletCapitalUsd } from '@/lib/agent-wallet-capital';
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
 * capital managed, and LIVE/TESTNET/SIMULATED mode classification.
 *
 * Capital managed is LIVE: every task funding is capital the agent controls from
 * the moment it lands in the agent wallet, so the primary reading is the wallet's
 * on-chain balance (BNB + tracked stablecoins, USD). When the chain is
 * unreachable, it falls back to the sum of open position values — never a
 * fabricated number.
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

    // Fetch agent for chainId detection + live wallet-capital read.
    const agentDoc = await db.collection(collections.agents).doc(id).get();
    const agentData = agentDoc.data();
    const chainId = agentData?.chainId ? Number(agentData.chainId) : null;
    const walletAddress = agentData?.walletAddress as string | undefined;

    // Capital the agent actually controls right now, read from the chain.
    // Runs concurrently with the document reads below; null on RPC failure
    // (summarize() then falls back to position-based capital).
    const walletCapitalPromise = getAgentWalletCapitalUsd(walletAddress);

    // Fetch executions (last 150 — FIRESTORE QUOTA: the dashboard/polling path
    // hits this endpoint per agent; 500 docs/agent/poll drained the 20k/day
    // read quota. 150 confirmed-execution docs are plenty for honest aggregates).
    // Single-field equality only — no composite orderBy, so no manual Firestore
    // index is required. Sort in-memory below.
    const execSnap = await db
      .collection(collections.executions)
      .where('agentId', '==', id)
      .limit(150)
      .get();

    const executions = sortByCreatedDesc(
      execSnap.docs.map((d) => d.data() as { createdAt: unknown })
    ) as any[];

    // Fetch position records (last 50 — see FIRESTORE QUOTA note above).
    const posSnap = await db
      .collection(collections.positions)
      .where('agentId', '==', id)
      .limit(50)
      .get();

    const positions = posSnap.docs.map((d) => ({
      ...d.data(),
      positionId: d.id,
    })) as any[];

    const walletCapitalUsd = await walletCapitalPromise;

    // Use the deterministic calculator to aggregate
    const summary = calculator.summarize(executions, positions, {
      walletCapitalUsd,
    });
    const modeResult = classifyExecutionMode(chainId, summary.confirmedCount);

    logger.info('performance_fetched', {
      agentId: id,
      totalTrades: summary.totalTrades,
      capitalManagedUsd: summary.capitalManagedUsd,
      capitalSource: walletCapitalUsd != null ? 'wallet-live' : 'positions',
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