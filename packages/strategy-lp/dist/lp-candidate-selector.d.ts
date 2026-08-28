/**
 * M11 — LpCandidateSelector.
 *
 * Deterministic filter → rank → bounded candidate set.
 *
 * The AI receives ONLY this bounded set — it never generates ticks/ranges.
 *
 * Steps:
 *   1. If position exists and is out of range → add REMOVE candidate (always valid).
 *   2. For each candidate range from LpRangeCalculator:
 *      - No position → CREATE candidate
 *      - Position exists → REPOSITION candidate (move to new range)
 *   3. Skip range-based candidates with negative net profit (but keep REMOVE).
 *   4. Rank by net profit (desc), then rank asc.
 *   5. Return bounded top-N (includes REMOVE if present).
 *
 * Candidate types:
 *   - REMOVE: existing position is out of range → extract liquidity (always kept)
 *   - CREATE: no position exists → create one at a computed range
 *   - REPOSITION: existing position → move to a different (better) range
 */
import { LpRangeCalculator } from './lp-calculator.js';
import { LpRiskModel } from './lp-risk-model.js';
import type { LpPoolState, LpPosition, LpRebalanceSignal } from './types.js';
export interface LpCandidateSelectorDeps {
    calculator?: LpRangeCalculator;
    riskModel?: LpRiskModel;
    maxCandidates?: number;
}
export declare class LpCandidateSelector {
    private readonly calc;
    private readonly risk;
    private readonly maxCandidates;
    constructor(deps?: LpCandidateSelectorDeps);
    /**
     * Select bounded rebalance candidates from a pool observation and optional
     * existing position. The AI MUST only receive this bounded set.
     */
    select(pool: LpPoolState, position: LpPosition | null): LpRebalanceSignal[];
    private buildRemoveCandidate;
    private inferTickSpacing;
    private estimateProjectedFees;
    private estimateSlippageCents;
    private buildReason;
}
//# sourceMappingURL=lp-candidate-selector.d.ts.map