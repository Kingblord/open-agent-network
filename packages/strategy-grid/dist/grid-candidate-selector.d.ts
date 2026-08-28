/**
 * M12 — GridCandidateSelector.
 *
 * Deterministic filtering and ranking of crossing candidates.
 * The AI ONLY receives the bounded output of this selector — it never
 * generates its own levels, prices, or order sizes.
 */
import { GridCalculator } from './grid-calculator.js';
import { GridRiskModel } from './grid-risk-model.js';
import type { GridCandidate, GridState } from './types.js';
export interface GridSelectorDeps {
    calculator?: GridCalculator;
    riskModel?: GridRiskModel;
}
export declare class GridCandidateSelector {
    private readonly calculator;
    private readonly riskModel;
    constructor(deps?: GridSelectorDeps);
    /**
     * Given a price observation and the current grid state, produce a bounded
     * candidate set (≤ topN). Returns empty array if no actionable crossing.
     */
    select(currentPriceCents: number, state: GridState, topN?: number): GridCandidate[];
    private distanceToStop;
}
//# sourceMappingURL=grid-candidate-selector.d.ts.map