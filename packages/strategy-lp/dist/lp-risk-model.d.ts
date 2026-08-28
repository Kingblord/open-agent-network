/**
 * M11 — LpRiskModel.
 *
 * Produces a risk level and risk-adjustment cost for a candidate rebalance.
 *
 * Risk factors considered:
 *   - Pool depth / 24h volume (low volume = HIGH risk)
 *   - Range width (very narrow = HIGH risk in volatile markets)
 *   - Fee tier (higher fee = more concentrated liquidity needed)
 *
 * Unknown / unavailable data = fail-closed (HIGH risk, never LOW).
 */
export interface LpRiskFactors {
    /** 24h volume in integer cents. */
    volumeUsdCents: string;
    /** Range width in whole ticks. */
    rangeWidthTicks: number;
    /** Pool fee in basis points. */
    feeBps: number;
    /** Whether volume data is available. */
    volumeAvailable: boolean;
}
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
/** Risk adjustment in integer cents (added to cost, reducing net profit). */
export interface LpRiskAssessment {
    level: RiskLevel;
    adjustmentCents: string;
    reason: string;
}
export declare class LpRiskModel {
    /**
     * Assess risk level and dollar adjustment for a candidate LP action.
     *
     * Unknown volume → HIGH risk (fail-closed, not LOW).
     */
    assess(factors: LpRiskFactors): LpRiskAssessment;
}
//# sourceMappingURL=lp-risk-model.d.ts.map