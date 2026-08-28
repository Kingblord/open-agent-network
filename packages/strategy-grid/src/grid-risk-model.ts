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
  adjustmentCents: string; // integer cents risk premium subtracted from netBenefit
}

export class GridRiskModel {
  assess(factors: GridRiskFactors): GridRiskAssessment {
    // Fail-closed: no volatility data → HIGH
    if (!factors.volatilityAvailable) {
      return { level: 'HIGH', adjustmentCents: '500' };
    }

    // High exposure + high volatility → HIGH
    if (factors.exposureRatioBps > 8000 && factors.volatilityBps > 500) {
      return { level: 'HIGH', adjustmentCents: '200' };
    }

    // Close to stop boundary → HIGH
    if (factors.distanceToStopCents < 1000) {
      return { level: 'HIGH', adjustmentCents: '100' };
    }

    // Moderate exposure or volatility → MEDIUM
    if (factors.exposureRatioBps > 5000 || factors.volatilityBps > 200) {
      return { level: 'MEDIUM', adjustmentCents: '50' };
    }

    return { level: 'LOW', adjustmentCents: '0' };
  }
}