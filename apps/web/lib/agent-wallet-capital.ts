import 'server-only';

import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { bsc } from 'viem/chains';
import { getBnbUsdPrice } from '@/lib/bnb-price';

/**
 * Live on-chain capital an agent's dedicated wallet currently holds, in USD.
 *
 * This is the honest, REALTIME "capital controlled by the agent": the funds a
 * user deposited into the agent wallet (BNB + tracked ERC-20s). It is derived
 * directly from the chain — never from a hand-maintained ledger and never
 * fabricated — so it automatically reflects deposits, withdrawals, and any
 * value the agent still controls. Protocol-deployed positions are reported
 * separately (see the positions collection), NOT summed here, to avoid
 * double-counting stale execution-time snapshots against live balances.
 *
 * Fails closed: any chain/RPC/price error yields a conservative reading with
 * the tokens it could reach; if nothing is readable it returns null so callers
 * can fall back rather than inventing a number.
 */

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** BSC mainnet tracked tokens (symbol → address + decimals). */
const TRACKED_TOKENS: Array<{ address: Address; decimals: number }> = [
  // USDT
  { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  // USDC
  { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
];

export interface AgentWalletCapital {
  /** Total controlled capital in USD (BNB*price + stablecoins 1:1). */
  totalUsd: number;
  /** Native BNB amount (human units). */
  bnb: number;
  /** Sum of tracked stablecoin amounts (USD ≈). */
  stablesUsd: number;
  /** BNB/USD price used (null when price lookup failed → bnb contributes 0). */
  bnbPriceUsd: number | null;
  /** Stablecoin balances individually could not be read. */
  partial: boolean;
}

export async function getAgentWalletCapital(
  walletAddress: string | null | undefined,
): Promise<AgentWalletCapital | null> {
  if (!walletAddress || !ADDRESS_RE.test(walletAddress)) return null;

  const rpcUrl = process.env.BAN_RPC_URL || 'https://bsc-dataseed1.binance.org';
  const client = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  const addr = walletAddress as `0x${string}`;

  let bnb = 0;
  try {
    bnb = Number(await client.getBalance({ address: addr })) / 1e18;
  } catch {
    return null; // native read failed — don't emit a half-truth
  }

  let stablesUsd = 0;
  let partial = false;
  for (const token of TRACKED_TOKENS) {
    try {
      const raw = await client.readContract({
        address: token.address,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [addr],
      });
      stablesUsd += Number(formatUnits(raw, token.decimals));
    } catch {
      partial = true; // one token unreadable — still report what we can
    }
  }

  const bnbPriceUsd = await getBnbUsdPrice();
  const bnbUsd = bnbPriceUsd != null ? bnb * bnbPriceUsd : 0;
  return {
    totalUsd: bnbUsd + stablesUsd,
    bnb,
    stablesUsd,
    bnbPriceUsd,
    partial,
  };
}

/**
 * Convenience wrapper: total live wallet capital as a decimal-USD string.
 * Returns '0' for an unprovisioned/invalid address and null only when the
 * chain read itself fails, so callers can fall back instead of inventing a
 * number.
 */
export async function getAgentWalletCapitalUsd(
  walletAddress: string | undefined | null,
): Promise<string | null> {
  const capital = await getAgentWalletCapital(walletAddress);
  if (capital == null) return null;
  return capital.totalUsd > 0 ? capital.totalUsd.toFixed(2) : '0';
}
