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
    };

    const lowerWallet = walletAddress.toLowerCase();
    const rows: TxRow[] = [];

    for (const tx of normalTxs) {
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
      });
    }

    for (const tx of tokenTxs) {
      const decimals = Number(tx.tokenDecimal || 18);
      rows.push({
        hash: tx.hash,
        block: Number(tx.blockNumber),
        timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
        from: tx.from,
        to: tx.to,
        value: (Number(tx.value) / 10 ** decimals).toFixed(4),
        token: tx.tokenSymbol || tx.tokenAddress.slice(0, 8),
        direction: tx.from.toLowerCase() === lowerWallet ? 'OUT' : 'IN',
        status: 'CONFIRMED',
        gasUsed: tx.gasUsed || '0',
        gasPriceGwei: tx.gasPrice ? (Number(tx.gasPrice) / 1e9).toFixed(2) : '0',
        kind: 'ERC20',
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
    });
  } catch (err) {
    logger.error('agent_transactions_failed', {}, err);
    return handleError(err);
  }
}
