import type { PriceDataAdapter, YieldAdapter, LendingAdapter, LiquidityAdapter, SwapAdapter } from './index.js';
import type { ToolAdapters } from './tools.js';
/**
 * Deterministic in-process provider. Implements the exact `ToolAdapters` shape
 * the tools consume — nested { price, swap, liquidity, yield, lending } plus a
 * `chain` adapter — so the same tool implementations work against this dev
 * provider and a future live BNB provider behind the same seam.
 */
export declare class DevDataProvider implements ToolAdapters {
    readonly price: PriceDataAdapter;
    readonly yield: YieldAdapter;
    readonly lending: LendingAdapter;
    readonly liquidity: LiquidityAdapter;
    readonly swap: SwapAdapter;
    readonly chain: ToolAdapters['chain'];
    private static _instance?;
    static instance(): DevDataProvider;
    constructor();
}
//# sourceMappingURL=dev-provider.d.ts.map