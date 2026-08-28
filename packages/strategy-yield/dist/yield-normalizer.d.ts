import type { NormalizedOpportunity, YieldOpportunity } from './types.js';
/**
 * Deterministic per-component cost model. Each opportunity may carry
 * protocol-specific fees; tooling costs (swap/gas/slippage) are stable scalars.
 * All values are integer bps. No floating-point arithmetic after the APY→bps
 * boundary in YieldDataProvider.
 */
export interface YieldNormalizerConfig {
    /** protocol -> protocol fee in bps. Protocols not listed default to 0. */
    protocolFeeBps?: Record<string, number>;
    swapCostBps?: number;
    gasCostBps?: number;
    slippageBps?: number;
}
export declare class YieldNormalizer {
    private readonly protocolFeeBps;
    private readonly swapCostBps;
    private readonly gasCostBps;
    private readonly slippageBps;
    constructor(cfg?: YieldNormalizerConfig);
    /**
     * Normalize a single raw opportunity into its component cost. Risk
     * adjustment is applied separately by YieldRiskModel; `effectiveYieldBps`
     * reflects gross − protocolFee − swap − gas − slippage (pre-risk).
     */
    normalize(opp: YieldOpportunity): Omit<NormalizedOpportunity, 'riskAdjustmentBps' | 'effectiveYieldBps'>;
    normalizeAll(opportunities: YieldOpportunity[]): Omit<NormalizedOpportunity, 'riskAdjustmentBps' | 'effectiveYieldBps'>[];
}
//# sourceMappingURL=yield-normalizer.d.ts.map