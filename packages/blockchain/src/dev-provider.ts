import type { ActionProposal } from '@ban/schemas';
import type {
  ProtocolAdapterSet,
  PriceDataAdapter,
  YieldAdapter,
  LendingAdapter,
  LiquidityAdapter,
  SwapAdapter,
} from './index.js';
import type { ToolAdapters } from './tools.js';

/**
 * M6 — Deterministic DevDataProvider (Rule 7: explicit dev/test provider,
 * built behind the SAME adapter seam as a future live BNB provider).
 *
 * It returns synthetic, deterministic market/lending/liquidity data so the tool
 * layer + registry (and the four strategy observation requirements) are fully
 * testable NOW without network access. It deliberately does NOT claim real
 * BNB Chain data completeness.
 *
 * Swap/lending/liquidity numbers are stable hashes of their inputs (not random),
 * so tests are reproducible and never flaky.
 *
 * The provider exposes the EXACT shape the tools consume — a ProtocolAdapterSet
 * with nested { price, yield, lending, liquidity, swap } PLUS a `chain` adapter —
 * so the same tool implementations work against this dev provider and a future
 * live BNB provider behind the same seam.
 */

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

function wei(input: string, salt: string): string {
  return String(BigInt(hash(input + ':' + salt)) * 1_000_000n);
}

function hex(input: string, salt: string): string {
  return '0x' + String(hash(input + ':' + salt));
}

function priceUsd(token: string): string {
  const cents = (hash(token) % 10_000) + 100; // 100..9999 cents (~$1..$99)
  return (cents / 100).toFixed(2);
}

/**
 * Deterministic in-process provider. Implements the exact `ToolAdapters` shape
 * the tools consume — nested { price, swap, liquidity, yield, lending } plus a
 * `chain` adapter — so the same tool implementations work against this dev
 * provider and a future live BNB provider behind the same seam.
 */
export class DevDataProvider implements ToolAdapters {
  readonly price: PriceDataAdapter;
  readonly yield: YieldAdapter;
  readonly lending: LendingAdapter;
  readonly liquidity: LiquidityAdapter;
  readonly swap: SwapAdapter;
  readonly chain: ToolAdapters['chain'];

  private static _instance?: DevDataProvider;

  static instance(): DevDataProvider {
    this._instance ??= new DevDataProvider();
    return this._instance;
  }

  constructor() {
    this.price = {
      async getTokenPrice(token: string) {
        return { asset: token.toUpperCase().slice(0, 8), priceUsd: priceUsd(token), timestamp: new Date().toISOString() };
      },
    };

    this.liquidity = {
      async getPoolState(poolAddress: string) {
        return {
          token0: hex(poolAddress, 't0'),
          token1: hex(poolAddress, 't1'),
          fee: 500,
          sqrtPriceX96: wei(poolAddress, 'sqrt'),
          tick: -1,
          liquidity: wei(poolAddress, 'liq'),
          volumeUsd24h: wei(poolAddress, 'vol'),
          timestamp: new Date().toISOString(),
        };
      },
      async getPoolPosition(poolAddress: string, owner: string) {
        const key = poolAddress + owner;
        return {
          positionId: hex(key, 'pos'),
          lowerTick: -50,
          upperTick: 50,
          liquidity: wei(key, 'liq'),
          token0Amount: wei(key, 't0'),
          token1Amount: wei(key, 't1'),
          feesUsd: wei(key, 'fee'),
          timestamp: new Date().toISOString(),
        };
      },
    };

    this.yield = {
      async getYieldOpportunities(network: string) {
        const apy = (hash(network) % 2000) / 100; // 0..20%
        return [
          { asset: 'BNB', protocol: 'pancake', apy, tvlUsd: '1000000', risk: 'LOW' as const, timestamp: new Date().toISOString() },
          { asset: 'USDT', protocol: 'venus', apy: 6.2, tvlUsd: '8500000', risk: 'MEDIUM' as const, timestamp: new Date().toISOString() },
        ];
      },
    };

    this.lending = {
      async getLendingPosition(address: string, protocol: string) {
        return {
          collateral: wei(address + protocol, 'collateral'),
          borrowed: wei(address + protocol, 'borrowed'),
          ltv: 0.55,
          liquidationThreshold: 0.8,
          healthFactor: 1.8,
          timestamp: new Date().toISOString(),
        };
      },
    };

    this.swap = {
      async getQuote(input: { tokenIn: string; tokenOut: string; amountIn: string; slippageBps: number }) {
        const amountIn = BigInt(input.amountIn || '0');
        const amountOut = (amountIn * 995n) / 1000n; // 0.5% fee
        return {
          amountOut: String(amountOut),
          priceImpactBps: input.slippageBps,
          route: ['0x' + hash(input.tokenIn + input.tokenOut).toString(16)],
          gasEstimate: '21000',
          timestamp: new Date().toISOString(),
        };
      },
      async simulate(_input: { tokenIn: string; tokenOut: string; amountIn: string; slippageBps: number }) {
        return { ok: true, amountOut: '0', revertReason: undefined };
      },
    };

    this.chain = {
      async getTokenBalance(input: { token: string; address: string }) {
        return {
          token: input.token,
          address: input.address,
          balance: wei(input.token + input.address, 'bal'),
          decimals: 18,
          timestamp: new Date().toISOString(),
        };
      },
      async getGasEstimate() {
        return { gasWei: '21000000000000', gasPriceGwei: '3', estimatedCostUsd: '0.10', timestamp: new Date().toISOString() };
      },
      async getTransactionStatus(hash: string) {
        return { status: 'CONFIRMED' as const, confirmations: 1, timestamp: new Date().toISOString() };
      },
      async simulateProposal(proposal: ActionProposal) {
        return {
          ok: true,
          estimated: { amountOut: wei(proposal.idempotencyKey, 'out'), priceImpactBps: 5, route: ['0xroute'] },
          gasWei: '21000000000000',
          timestamp: new Date().toISOString(),
        };
      },
    };
  }
}