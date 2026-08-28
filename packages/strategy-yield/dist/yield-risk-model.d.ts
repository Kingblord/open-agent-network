import type { NormalizedOpportunity, RiskLevel } from './types.js';
export declare class YieldRiskModel {
    /** Integer bps deducted for a given opportunity risk tier. */
    adjustmentBps(risk: RiskLevel): number;
    private compatible;
    /**
     * Apply per-tier risk adjustments and compatibility filtering.
     * - throws on unknown/missing opportunity risk (fail-closed)
     * - drops (does not rank) opportunities whose risk tier exceeds the agent profile
     * - sets `effectiveYieldBps = gross − fee − swap − gas − slippage − adjustment`
     */
    apply(normalized: Omit<NormalizedOpportunity, 'riskAdjustmentBps' | 'effectiveYieldBps'>[], agentRisk: RiskLevel): NormalizedOpportunity[];
}
//# sourceMappingURL=yield-risk-model.d.ts.map