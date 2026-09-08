import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { getNormalTransactions, getTokenTransactions } from '@/lib/etherscan';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.transactions');

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/:id/transactions
 *
 * Real-time ON-CHAIN transaction history for the agent's dedicated wallet,
 * read through the rate-limited Etherscan V2 client (BSC, chainid 56).
 *
 * - Owner-only (same rule as /activity).
 * - The Etherscan client serialises upstream calls (≤3/s, free plan cap 5/s)
 *   and caches per-address results for 30s, so repeated dashboard polling and
 *   the 2-minute Inngest cadence never burn through the 100k/day quota.
 * - Fails soft: upstream errors return an empty list + a note, never a fake tx.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      return errorResponse(403, 'Transactions are only visible to the account that owns this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const walletAddress = agent.walletAddress;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json({
        ok: true,
        agentId: id,
        transactions: [],
        note: 'Agent has no provisioned wallet yet — create a task to provision it.',
      });
    }

    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '50') || 50, 100);

    // Both reads go through the shared rate-limiter; tokentx + txlist = 2 calls
    // per uncached page view (30s cache window) — well within the free plan.
    const [normalTxs, tokenTxs] = await Promise.all([
      getNormalTransactions(walletAddress, limit),
      getTokenTransactions(walletAddress, limit),
    ]);

    type TxRow = {
      hash: string;
      block: number;
      timestamp: string;
      from: string;
      to: string;
      value: string;
      token: string;
      direction: 'OUT' | 'IN';
      status: 'CONFIRMED' | 'FAILED';
      gasUsed: string;
      gasPriceGwei: string;
      kind: 'NATIVE' | 'ERC20';
      /** Human-readable classification shown in the UI. */
      category: 'FUNDING' | 'AGENT_EXECUTION' | 'GAS' | 'WITHDRAWAL' | 'TRANSFER';
      label: string;
    };

    const lowerWallet = walletAddress.toLowerCase();
    const rows: TxRow[] = [];

    /**
     * Classify a native (BNB) transfer relative to the agent wallet:
     *   - OUT with empty calldata → owner WITHDRAWAL (escape hatch); zero-value
     *     empty sends are gas/internal ops
     *   - IN from a non-agent address → user FUNDING
     *   - anything else (non-empty calldata OUT) → AGENT_EXECUTION
     */
    function classifyNative(tx: { from: string; to: string; input?: string; value?: string }): { category: TxRow['category']; label: string } {
      const isOut = tx.from.toLowerCase() === lowerWallet;
      const input = typeof tx.input === 'string' ? tx.input : '';
      const isEmptyCall = !input || input === '0x';
      const value = typeof tx.value === 'string' ? Number(tx.value) : NaN;
      if (isOut) {
        if (isEmptyCall && value === 0) return { category: 'GAS', label: 'Gas refund / internal' };
        if (isEmptyCall) return { category: 'WITHDRAWAL', label: 'Owner withdrawal (BNB)' };
        return { category: 'AGENT_EXECUTION', label: 'Agent execution (BNB call)' };
      }
      return { category: 'FUNDING', label: 'Task funding deposit (BNB)' };
    }

    for (const tx of normalTxs) {
      const { category, label } = classifyNative(tx);
      rows.push({
        hash: tx.hash,
        block: Number(tx.blockNumber),
        timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
        from: tx.from,
        to: tx.to,
        value: (Number(tx.value) / 1e18).toFixed(6),
        token: 'BNB',
        direction: tx.from.toLowerCase() === lowerWallet ? 'OUT' : 'IN',
        status: tx.isError === '0' && tx.txReceiptStatus !== '0' ? 'CONFIRMED' : 'FAILED',
        gasUsed: tx.gasUsed,
        gasPriceGwei: (Number(tx.gasPrice) / 1e9).toFixed(2),
        kind: 'NATIVE',
        category,
        label,
      });
    }

    for (const tx of tokenTxs) {
      const decimals = Number(tx.tokenDecimal || 18);
      const isOut = tx.from.toLowerCase() === lowerWallet;
      const symbol = tx.tokenSymbol || tx.tokenAddress.slice(0, 8);
      // Stablecoin/WBNB OUT moves are agent executions (swap/approve leg or
      // lending supply); IN moves are funding. Pure native-BNB funding is
      // classified in the loop above.
      const isStable = /usdt|usdc|busd/i.test(symbol);const category: TxRow['category'] = isOut
        ? 'AGENT_EXECUTION'
        : 'FUNDING';
      const label = isOut
        ? `Agent execution (token spend — ${symbol})`
        : `Task funding deposit (${symbol})`;
      rows.push({
        hash: tx.hash,
        block: Number(tx.blockNumber),
        timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
        from: tx.from,
        to: tx.to,
        value: (Number(tx.value) / 10 ** decimals).toFixed(4),
        token: symbol,
        direction: isOut ? 'OUT' : 'IN',
        status: 'CONFIRMED',
        gasUsed: tx.gasUsed || '0',
        gasPriceGwei: tx.gasPrice ? (Number(tx.gasPrice) / 1e9).toFixed(2) : '0',
        kind: 'ERC20',
        category,
        label,
      });
    }

    rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    logger.info('agent_transactions_fetched', {
      agentId: id,
      count: rows.length,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({
      ok: true,
      agentId: id,
      walletAddress,
      transactions: rows.slice(0, limit),
      source: normalTxs.length + tokenTxs.length > 0 ? 'etherscan-v2' : 'empty',
      // Honest note for the common empty case: distinguish 'no activity yet'
      // from 'Etherscan unavailable' so the UI can show the actionable reason.
      note: normalTxs.length + tokenTxs.length === 0
        ? process.env.ETHERSCAN_API_KEY
          ? 'No on-chain activity found for this wallet yet. If you expected transactions, Etherscan may be rate-limited — try again shortly.'
          : 'ETHERSCAN_API_KEY is not configured on this deployment — on-chain history is unavailable until it is set (Settings → Environment Variables).'
        : undefined,
    });
  } catch (err) {
    logger.error('agent_transactions_failed', {}, err);
    return handleError(err);
  }
}
