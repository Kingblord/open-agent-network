/**
 * M11 — LpDataProvider.
 *
 * Wraps the blockchain LiquidityAdapter into M11's normalized snapshot types.
 * All amounts are returned as integer decimal strings (cents, wei, basis points).
 * Token orientation is surfaced explicitly — never assumed token0/token1 = user's quote/base.
 */
import type { LpPoolState, LpPosition } from './types.js';
import type { LiquidityAdapter, PriceDataAdapter } from '@ban/blockchain';
import { LpRangeCalculator } from './lp-calculator.js';
export interface LpDataProviderDeps {
    liquidity: Pick<LiquidityAdapter, 'getPoolState' | 'getPoolPosition'>;
    price: Pick<PriceDataAdapter, 'getTokenPrice'>;
    calculator?: LpRangeCalculator;
}
export declare class LpDataProvider {
    private readonly deps;
    private readonly calc;
    constructor(deps: LpDataProviderDeps);
    fetchPoolState(poolAddress: string, decimals0: number, decimals1: number): Promise<LpPoolState>;
    fetchPosition(poolAddress: string, owner: string): Promise<LpPosition>;
}
//# sourceMappingURL=lp-data-provider.d.ts.map