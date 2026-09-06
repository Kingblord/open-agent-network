/**
 * M11 — LpDataProvider.
 *
 * Wraps the blockchain LiquidityAdapter into M11's normalized snapshot types.
 * All amounts are returned as integer decimal strings (cents, wei, basis points).
 * Token orientation is surfaced explicitly — never assumed token0/token1 = user's quote/base.
 */

import type { LpPoolState, LpPosition, TokenDecimalInfo } from './types.js';
import type { ChainAdapter, LiquidityAdapter, PriceDataAdapter } from '@ban/blockchain';
import { LpRangeCalculator } from './lp-calculator.js';

export interface LpDataProviderDeps {
  liquidity: Pick<LiquidityAdapter, 'getPoolState' | 'getPoolPosition'>;
  price: Pick<PriceDataAdapter, 'getTokenPrice'>;
  chain?: Pick<ChainAdapter, 'getGasEstimate'>;
  calculator?: LpRangeCalculator;
}

export class LpDataProvider {
  private readonly deps: LpDataProviderDeps;
  private readonly calc: LpRangeCalculator;

  constructor(deps: LpDataProviderDeps) {
    this.deps = deps;
    this.calc = deps.calculator ?? new LpRangeCalculator();
  }

  async fetchPoolState(poolAddress: string, decimals0: number, decimals1: number): Promise<LpPoolState> {
    const raw = await this.deps.liquidity.getPoolState(poolAddress);
    const sqrtX96 = raw.sqrtPriceX96;
    const tick = this.calc.sqrtPriceX96ToTick(sqrtX96);
    const token0PriceUsd = await this.deps.price.getTokenPrice(raw.token0);
    const token1PriceUsd = await this.deps.price.getTokenPrice(raw.token1);
    let gasEstimateUsdCents: string | undefined;
    if (this.deps.chain) {
      const gas = await this.deps.chain.getGasEstimate({ action: 'lp-rebalance' });
      const gasUsd = Number.parseFloat(gas.estimatedCostUsd);
      if (Number.isFinite(gasUsd) && gasUsd >= 0) gasEstimateUsdCents = String(Math.round(gasUsd * 100));
    }

    return {
      poolAddress,
      token0: raw.token0,
      token1: raw.token1,
      feeBps: raw.fee,
      sqrtPriceX96: sqrtX96,
      tick,
      liquidity: raw.liquidity,
      volumeUsdCents: raw.volumeUsd24h,
      timestamp: raw.timestamp,
      decimals0,
      decimals1,
      token0PriceUsd: token0PriceUsd.priceUsd,
      token1PriceUsd: token1PriceUsd.priceUsd,
      gasEstimateUsdCents,
      gasEstimateAvailable: gasEstimateUsdCents !== undefined,
    };
  }

  async fetchPosition(poolAddress: string, owner: string): Promise<LpPosition> {
    const raw = await this.deps.liquidity.getPoolPosition(poolAddress, owner);
    return {
      positionId: raw.positionId,
      lowerTick: raw.lowerTick,
      upperTick: raw.upperTick,
      liquidity: raw.liquidity,
      token0Amount: raw.token0Amount,
      token1Amount: raw.token1Amount,
      feesUsd: raw.feesUsd,
      timestamp: raw.timestamp,
    };
  }
}