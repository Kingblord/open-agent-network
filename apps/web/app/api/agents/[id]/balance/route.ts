import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { bsc } from 'viem/chains';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { getBnbUsdPrice } from '@/lib/bnb-price';

export const dynamic = 'force-dynamic';

/** ERC-20 balanceOf — minimal ABI for reading token balances. */
const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** BSC mainnet USDT and USDC contract addresses. */
const TOKEN_ADDRESSES: Record<string, Address> = {
  USDT: '0x55d398326f99059fF775485246999027B3197955' as Address,
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as Address,
};

/**
 * GET /api/agents/[id]/balance
 *
 * Returns the agent's dedicated wallet ON-CHAIN balances (chainId 56):
 *   - Native BNB balance
 *   - USDT (ERC-20) balance
 *   - USDC (ERC-20) balance
 *   - Combined USD value
 *
 * Read-only chain data — never fabricated.
 *
 * - Balances are read live via a viem public client over BAN_RPC_URL (BSC mainnet).
 * - USD rate comes from CoinGecko (simple price), cached in-process for 60s.
 * - When the price lookup fails, balanceUsd is null (token balances still shown).
 * - When the agent has no provisioned wallet, all balance fields are null.
 * - On any chain/RPC error we fail CLOSED (nulls) — we never invent a balance.
 */

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

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
        balanceUsdt: null,
        balanceUsdc: null,
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

    // Read ERC-20 USDT and USDC balances via balanceOf(address).
    const [usdtResult, usdcResult] = await Promise.allSettled([
      client.readContract({
        address: TOKEN_ADDRESSES.USDT,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      }),
      client.readContract({
        address: TOKEN_ADDRESSES.USDC,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      }),
    ]);
    const usdtRaw = usdtResult.status === 'fulfilled' ? usdtResult.value : 0n;
    const usdcRaw = usdcResult.status === 'fulfilled' ? usdcResult.value : 0n;
    const tokenReadError = usdtResult.status === 'rejected' || usdcResult.status === 'rejected';

    const usdt = Number(formatUnits(usdtRaw, 18));
    const usdc = Number(formatUnits(usdcRaw, 18));

    const price = await getBnbUsdPrice();
    const balanceBnb = formatBnb(bnb);
    const balanceUsdt = usdt > 0 ? usdt.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0' : '0';
    const balanceUsdc = usdc > 0 ? usdc.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0' : '0';
    // Total USD = BNB * price + USDT (1:1) + USDC (1:1)
    const totalUsd = (price != null ? bnb * price : 0) + usdt + usdc;
    const balanceUsd = totalUsd > 0 ? totalUsd.toFixed(2) : null;

    return NextResponse.json({
      ok: true,
      agentId: id,
      address: walletAddress,
      balanceBnb,
      balanceUsdt,
      balanceUsdc,
      balanceUsd,
      usdPrice: price,
      tokenBalancesComplete: !tokenReadError,
      updatedAt,
    });
  } catch {
    // Fail closed: never fabricate a balance on chain/DB errors.
    return NextResponse.json({
      ok: false,
      agentId: id,
      address: null,
      balanceBnb: null,
      balanceUsdt: null,
      balanceUsdc: null,
      balanceUsd: null,
      usdPrice: null,
      updatedAt,
    });
  }
}