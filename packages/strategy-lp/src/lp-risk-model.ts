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

import { BANError, ErrorCode } from '@ban/shared';

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

export class LpRiskModel {
  /**
   * Assess risk level and dollar adjustment for a candidate LP action.
   *
   * Unknown volume → HIGH risk (fail-closed, not LOW).
   */
  assess(factors: LpRiskFactors): LpRiskAssessment {
    // Fail-closed: no volume data = HIGH
    if (!factors.volumeAvailable) {
      return { level: 'HIGH', adjustmentCents: '500', reason: 'No volume data available — fail-closed HIGH' };
    }

    const volume = BigInt(factors.volumeUsdCents || '0');
    const range = factors.rangeWidthTicks;
    const isNarrow = range < 10;

    // Low volume pool → higher risk
    if (volume < 1_000_000n) {
      // < $10k volume
      return { level: 'HIGH', adjustmentCents: '300', reason: 'Low pool volume (<$10k)' };
    }

    if (volume < 10_000_000n) {
      // < $100k volume
      return { level: 'MEDIUM', adjustmentCents: '100', reason: 'Moderate pool volume (<$100k)' };
    }

    // Narrow range in volatile pool conditions
    if (isNarrow && factors.feeBps >= 100) {
      return { level: 'MEDIUM', adjustmentCents: '50', reason: 'Narrow range in higher-fee pool' };
    }

    return { level: 'LOW', adjustmentCents: '0', reason: 'Sufficient volume and range' };
  }
}