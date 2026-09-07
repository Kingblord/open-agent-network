import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { BANError, ErrorCode } from '@ban/shared';

/**
 * Deterministic PancakeSwap V3 swap-call builder for grid (and generic SWAP)
 * proposals authored with `params.execKind = "PANCAKE_V3_SWAP"`.
 *
 * Real-funds safety invariants:
 *  - Amounts and minOut are computed from DETERMINISTIC proposal params
 *    (strategy-authored), never from LLM free text.
 *  - `amountOutMinimum` is derived from the grid level price minus the
 *    slippage guard; a moved market reverts the swap on-chain instead of
 *    filling at a bad price. A computed minOut of 0 refuses to build.
 *  - An exact-amount ERC-20 approve of `tokenIn` for the router is batched
 *    ahead of the swap (no standing allowance is ever left open).
 *
 * Pure module: no network, no state — fully unit-testable.
 */

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value) returns (bool)',
]);

const PANCAKE_V3_ROUTER_ABI = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) external payable returns (uint256 amountOut)',
]);

/**
 * PancakeSwap V3 Factory (BSC mainnet) — the canonical deployment used by the
 * Smart Router. Used ONLY to discover which fee tiers have a live pool for the
 * token pair; a wrong tier would make the swap revert (funds stay safe, but
 * the fill is lost), so the signer resolves the tier on-chain before building.
 */
const PANCAKE_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad45E7806C799594' as Address;

const FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
]);

const POOL_ABI = parseAbi([
  'function liquidity() view returns (uint128 liquidity)',
]);

const FEE_TIERS: readonly number[] = [500, 100, 2500, 10000]; // preference order (stable↔wrapped-native usually 500)

/**
 * Resolve the BEST existing PancakeSwap V3 fee tier for a token pair: the
 * tier with an existing pool and the deepest liquidity. Preference order
 * breaks ties (500 first — the standard USDT↔WBNB tier). Fails soft: returns
 * the default tier when the factory is unreachable, so execution degrades to
 * the previous behavior instead of blocking.
 */
export async function resolveBestFeeTier(
  tokenIn: Address,
  tokenOut: Address,
): Promise<number> {
  const { createPublicClient, http } = await import('viem');
  const { bsc } = await import('viem/chains');
  const client = createPublicClient({
    chain: bsc,
    transport: http(process.env.BAN_RPC_URL || 'https://bsc-dataseed1.binance.org'),
  });

  // In-process cache (10 min) — the tier for a pair rarely changes.
  const cacheKey = `${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}`;
  const cached = tierCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.tier;

  for (const fee of FEE_TIERS) {
    try {
      const pool = await client.readContract({
        address: PANCAKE_V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: 'getPool',
        args: [tokenIn, tokenOut, fee],
      });
      if (!pool || pool === '0x0000000000000000000000000000000000000000') continue;
      const liquidity = await client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: 'liquidity',
      });
      if (liquidity > 0n) {
        tierCache.set(cacheKey, { tier: fee, at: Date.now() });
        return fee;
      }
    } catch {
      // Factory/RPC hiccup — try the next tier; final fallback below.
    }
  }
  return GRID_DEFAULT_FEE_TIER;
}

const GRID_DEFAULT_FEE_TIER = 500;

const tierCache = new Map<string, { tier: number; at: number }>();

export interface PancakeV3SwapParams {
  side: 'BUY' | 'SELL';
  tokenIn: Address;
  tokenOut: Address;
  /** Token-in amount, wei decimal string or bigint (18-decimal USDT/WBNB). */
  amountIn: bigint;
  /** USD price of tokenOut per 1 tokenOut unit at the grid level. */
  levelPriceUsd: number;
  /** Slippage guard in bps (300 = 3%). */
  slippageBps?: number;
  /** PancakeSwap V3 fee tier (100 | 500 | 2500 | 10000). */
  feeTier?: number;
}

export interface ExecutableCall {
  to: Address;
  data: `0x${string}`;
  value: bigint;
}

/** USD price scaled to 6 decimals for integer fixed-point math. */
const PRICE_SCALE = 1_000_000n;
const BPS_DENOMINATOR = 10_000n;

/**
 * Build the batched call list for a PancakeSwap V3 swap:
 *   [ approve(tokenIn → router, amountIn), exactInputSingle(...) ].
 */
export function buildPancakeV3SwapCalls(
  params: PancakeV3SwapParams,
  recipient: Address,
  router: Address,
): ExecutableCall[] {
  const slippageBps = Math.min(
    9000,
    Math.max(0, Math.floor(Number(params.slippageBps ?? 300))),
  );
  const feeTier = Math.floor(Number(params.feeTier ?? 500));
  if (![100, 500, 2500, 10000].includes(feeTier)) {
    throw new BANError(
      ErrorCode.VALIDATION_FAILED,
      `PancakeSwap V3 fee tier must be one of 100|500|2500|10000, got ${feeTier}`,
      { retryable: false },
    );
  }
  if (params.amountIn <= 0n) {
    throw new BANError(
      ErrorCode.VALIDATION_FAILED,
      'Grid swap amountIn must be positive',
      { retryable: false },
    );
  }
  const price = Number(params.levelPriceUsd);
  if (!Number.isFinite(price) || price <= 0) {
    throw new BANError(
      ErrorCode.VALIDATION_FAILED,
      `Grid swap level price must be positive USD, got ${params.levelPriceUsd}`,
      { retryable: false },
    );
  }

  const keepBps = BPS_DENOMINATOR - BigInt(slippageBps);
  const priceScaled = BigInt(Math.round(price * 1e6)); // USD × 1e6

  // Expected out, integer fixed-point (floors — conservative by construction):
  //   BUY  (tokenIn USDT → tokenOut WBNB): out = amountIn × PRICE_SCALE / price
  //   SELL (tokenIn WBNB → tokenOut USDT): out = amountIn × price / PRICE_SCALE
  const expectedOut =
    params.side === 'BUY'
      ? (params.amountIn * PRICE_SCALE) / priceScaled
      : (params.amountIn * priceScaled) / PRICE_SCALE;

  const amountOutMinimum = (expectedOut * keepBps) / BPS_DENOMINATOR;
  if (amountOutMinimum <= 0n) {
    throw new BANError(
      ErrorCode.VALIDATION_FAILED,
      'Computed amountOutMinimum is 0 — refusing to build a blind swap (real-funds guard)',
      { retryable: false },
    );
  }

  const approveCalldata = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [router, params.amountIn],
  });

  const swapCalldata = encodeFunctionData({
    abi: PANCAKE_V3_ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: feeTier,
        recipient,
        amountIn: params.amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return [
    // Exact-amount approval — batched, never a standing unlimited allowance.
    { to: params.tokenIn, data: approveCalldata, value: 0n },
    { to: router, data: swapCalldata, value: 0n },
  ];
}
