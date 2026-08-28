import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { getAdminDb, collections } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/[id]/balance
 *
 * Returns the agent's dedicated wallet ON-CHAIN BNB balance (chainId 56) plus an
 * approximate USD value. Read-only chain data — never fabricated.
 *
 * - Balance is read live via a viem public client over BAN_RPC_URL (BSC mainnet).
 * - USD rate comes from CoinGecko (simple price), cached in-process for 60s.
 * - When the price lookup fails, balanceUsd is null (BNB balance still shown).
 * - When the agent has no provisioned wallet, all balance fields are null.
 * - On any chain/RPC error we fail CLOSED (nulls) — we never invent a balance.
 */

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

let priceCache: { price: number; at: number } | null = null;

async function getBnbUsdPrice(): Promise<number | null> {
  const now = Date.now();
  if (priceCache && now - priceCache.at < 60_000) return priceCache.price;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return priceCache?.price ?? null;
    const json = (await res.json()) as { binancecoin?: { usd?: unknown } };
    const price = Number(json?.binancecoin?.usd);
    if (!Number.isFinite(price) || price <= 0) return priceCache?.price ?? null;
    priceCache = { price, at: now };
    return price;
  } catch {
    return priceCache?.price ?? null;
  }
}

function formatBnb(value: number): string {
  if (value === 0) return '0';
  // 6 decimals max, trailing zeros trimmed (never rounds up to a fake value).
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const updatedAt = new Date().toISOString();

  try {
    // Resolve the agent's bound wallet address (the authoritative registry record).
    const db = getAdminDb();
    const agentDoc = await db.collection(collections.agents).doc(id).get();
    const agentData = agentDoc.data();
    const walletAddress = agentData?.walletAddress as string | undefined;

    if (!walletAddress || !ADDRESS_RE.test(walletAddress)) {
      return NextResponse.json({
        ok: true,
        agentId: id,
        address: null,
        balanceBnb: null,
        balanceUsd: null,
        usdPrice: null,
        updatedAt,
      });
    }

    // Live on-chain BNB balance (BSC mainnet, chainId 56).
    const rpcUrl = process.env.BAN_RPC_URL || 'https://bsc-dataseed1.binance.org';
    const client = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
    const wei = await client.getBalance({ address: walletAddress as `0x${string}` });
    const bnb = Number(wei) / 1e18;

    const price = await getBnbUsdPrice();
    const balanceBnb = formatBnb(bnb);
    const balanceUsd = price != null ? (bnb * price).toFixed(2) : null;

    return NextResponse.json({
      ok: true,
      agentId: id,
      address: walletAddress,
      balanceBnb,
      balanceUsd,
      usdPrice: price,
      updatedAt,
    });
  } catch {
    // Fail closed: never fabricate a balance on chain/DB errors.
    return NextResponse.json({
      ok: false,
      agentId: id,
      address: null,
      balanceBnb: null,
      balanceUsd: null,
      usdPrice: null,
      updatedAt,
    });
  }
}