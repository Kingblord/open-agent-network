/**
 * M12 — GridRiskModel.
 *
 * Assesses risk for a grid crossing candidate.
 * Unknown/unavailable market data → HIGH (fail-closed).
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export interface GridRiskFactors {
    /** Current grid active exposure ratio (0..1, as integer basis points). */
    exposureRatioBps: number;
    /** Volatility signal (larger = more volatile). 0 = unknown. */
    volatilityBps: number;
    /** True if volatility data was available. */
    volatilityAvailable: boolean;
    /** Distance from price to stop boundary, in integer cents. */
    distanceToStopCents: number;
}
export interface GridRiskAssessment {
    level: RiskLevel;
    adjustmentCents: string;
}
export declare class GridRiskModel {
    assess(factors: GridRiskFactors): GridRiskAssessment;
}
//# sourceMappingURL=grid-risk-model.d.ts.map