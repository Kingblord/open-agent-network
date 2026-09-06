import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { getNormalTransactions, getTokenTransactions } from '@/lib/etherscan';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.history');

// Tokens the system tracks
const TOKENS: Record<string, { address: string; symbol: string; decimals: number }> = {
  BNB: { address: '', symbol: 'BNB', decimals: 18 },
  USDT: { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
  USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
  WBNB: { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', decimals: 18 },
};

export interface OnchainTx {
  hash: string;
  block: number;
  timestamp: string;
  from: string;
  to: string;
  value: string;
  token: string;
  valueUsd: number;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
  status: 'CONFIRMED' | 'FAILED';
  agentId?: string;
  agentName?: string;
  gasUsed: string;
  gasPriceGwei: string;
}

/**
 * GET /api/developers/history?address=0x...
 *
 * Fetches real on-chain transactions for a user's wallet address.
 * Uses BscScan API to get BNB transfers + ERC-20 transfers.
 * Cross-references known agent wallet addresses for labeling.
 *
 * Returns agent audit events AND real on-chain tx history combined.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }

    const address = request.nextUrl.searchParams.get('address') || '';
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return errorResponse(422, 'Valid address required', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // Fetch agent wallet addresses for cross-referencing
    const agentWalletMap: Record<string, { name: string; id: string }> = {};
    const auditEvents: any[] = [];
    try {
      const db = getAdminDb();
      const agentsSnap = await db.collection(collections.agents).where('ownerId', '==', user.developerId).get();
      const agentIds: string[] = [];
      agentsSnap.forEach((d) => {
        const data = d.data();
        agentIds.push(d.id);
        // Map wallet address → agent name/id for tagging
        if (data.walletAddress) {
          const addr = (data.walletAddress as string).toLowerCase();
          agentWalletMap[addr] = { name: data.name || d.id, id: d.id };
        }
      });

      for (const agentId of agentIds.slice(0, 5)) {
        try {
          const snap = await db
            .collection(collections.auditEvents)
            .where('agentId', '==', agentId)
            .orderBy('createdAt', 'desc')
            .limit(30)
            .get();
          snap.forEach((d) => auditEvents.push({ id: d.id, ...d.data() }));
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    // Fetch real on-chain transactions via the rate-limited Etherscan V2 client
    // (BSC chainid 56). Shared per-process cache + 300ms spacing keeps us under
    // the free-plan 5/s and 100k/day limits.
    const onchainTxs: OnchainTx[] = [];

    const [normalTxs, tokenTxs] = await Promise.all([
      getNormalTransactions(address, 50),
      getTokenTransactions(address, 50),
    ]);

    // Helper: tag tx with agent info if wallet matches an agent
    function tagAgent(tx: { from: string; to: string }): { agentId?: string; agentName?: string } {
      const fromLower = tx.from.toLowerCase();
      const toLower = tx.to.toLowerCase();
      if (agentWalletMap[fromLower]) return { agentId: agentWalletMap[fromLower].id, agentName: agentWalletMap[fromLower].name };
      if (agentWalletMap[toLower]) return { agentId: agentWalletMap[toLower].id, agentName: agentWalletMap[toLower].name };
      return {};
    }

    // Process BNB transactions (typed by the shared Etherscan V2 client)
    for (const tx of normalTxs.slice(0, 30)) {
      const isOut = tx.from.toLowerCase() === address.toLowerCase();
      const valueBnb = Number(tx.value) / 1e18;
      onchainTxs.push({
        hash: tx.hash,
        block: Number(tx.blockNumber),
        timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
        from: tx.from,
        to: tx.to,
        value: valueBnb.toFixed(6),
        token: 'BNB',
        valueUsd: 0,
        type: isOut ? 'WITHDRAWAL' : 'DEPOSIT',
        status: tx.isError === '0' && tx.txReceiptStatus !== '0' ? 'CONFIRMED' : 'FAILED',
        gasUsed: tx.gasUsed,
        gasPriceGwei: (Number(tx.gasPrice) / 1e9).toFixed(2),
        ...tagAgent(tx),
      });
    }

    // Process token transactions (USDT, USDC, etc.)
    for (const tx of tokenTxs.slice(0, 30)) {
      const isOut = tx.from.toLowerCase() === address.toLowerCase();
      const tokenSymbol = tx.tokenSymbol || 'UNKNOWN';
      const decimals = Number(tx.tokenDecimal || 18);
      const value = Number(tx.value) / 10 ** decimals;
      onchainTxs.push({
        hash: tx.hash,
        block: Number(tx.blockNumber),
        timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
        from: tx.from,
        to: tx.to,
        value: value.toFixed(4),
        token: tokenSymbol,
        valueUsd: 0,
        type: isOut ? 'WITHDRAWAL' : 'DEPOSIT',
        status: 'CONFIRMED',
        gasUsed: tx.gasUsed || '0',
        gasPriceGwei: tx.gasPrice ? (Number(tx.gasPrice) / 1e9).toFixed(2) : '0',
        ...tagAgent(tx),
      });
    }

    // Fetch BNB price to calculate USD values
    let bnbPrice = 600;
    try {
      const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd', {
        signal: AbortSignal.timeout(3000),
      });
      if (priceRes.ok) {
        const priceJson = await priceRes.json() as { binancecoin?: { usd?: number } };
        if (priceJson?.binancecoin?.usd) bnbPrice = priceJson.binancecoin.usd;
      }
    } catch { /* use fallback */ }

    // Enrich with USD values + agent labels
    const enrichedTxs = onchainTxs.map((tx) => ({
      ...tx,
      valueUsd: tx.token === 'BNB' ? Number(tx.value) * bnbPrice : Number(tx.value),
    }));

    // Sort combined: onchain + audit, newest first
    const combined = [
      ...enrichedTxs.map((tx) => ({
        id: `tx_${tx.hash}`,
        type: 'ONCHAIN',
        eventType: tx.type === 'DEPOSIT' ? 'DEPOSIT_CONFIRMED' : 'WITHDRAWAL_CONFIRMED',
        source: 'bscscan',
        timestamp: tx.timestamp,
        payload: tx,
      })),
      ...auditEvents.map((ev) => ({
        id: ev.id,
        type: 'AUDIT',
        eventType: ev.type,
        source: 'ban',
        timestamp: ev.createdAt,
        payload: ev.detail || {},
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
      ok: true,
      history: combined.slice(0, 100),
      onchainCount: enrichedTxs.length,
      auditCount: auditEvents.length,
      bnbPrice,
    });
  } catch (err) {
    logger.error('history_fetch_failed', {}, err);
    return handleError(err);
  }
}

// On-chain reads go through the shared rate-limited Etherscan V2 client
// (lib/etherscan.ts) — cached + throttled to respect the free-plan limits.