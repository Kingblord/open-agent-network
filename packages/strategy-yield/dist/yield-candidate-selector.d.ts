import type { NormalizedOpportunity, YieldCandidate } from './types.js';
/**
 * M9 — YieldCandidateSelector.
 *
 * Deterministic filtering → ranking → bounded top-N. The AI receives ONLY the
 * output of this selector (never raw market data). Tie-breaking is fully
 * ordered: higher effective yield, then higher TVL, then protocol/asset
 * alphabetically — so the result is reproducible across runs.
 */
export declare class YieldCandidateSelector {
    private readonly topN;
    private readonly minEffectiveYieldBps;
    constructor(topN?: number, minEffectiveYieldBps?: number);
    select(all: NormalizedOpportunity[]): YieldCandidate[];
}
//# sourceMappingURL=yield-candidate-selector.d.ts.map