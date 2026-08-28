/**
 * M12 — GridCandidateSelector.
 *
 * Deterministic filtering and ranking of crossing candidates.
 * The AI ONLY receives the bounded output of this selector — it never
 * generates its own levels, prices, or order sizes.
 */
import { GridCalculator } from './grid-calculator.js';
import { GridRiskModel, type GridRiskAssessment, type GridRiskFactors } from './grid-risk-model.js';
import type { GridConfig, GridLevel, GridCrossing, GridCandidate, GridState } from './types.js';

export interface GridSelectorDeps {
  calculator?: GridCalculator;
  riskModel?: GridRiskModel;
}

export class GridCandidateSelector {
  private readonly calculator: GridCalculator;
  private readonly riskModel: GridRiskModel;

  constructor(deps?: GridSelectorDeps) {
    this.calculator = deps?.calculator ?? new GridCalculator();
    this.riskModel = deps?.riskModel ?? new GridRiskModel();
  }

  /**
   * Given a price observation and the current grid state, produce a bounded
   * candidate set (≤ topN). Returns empty array if no actionable crossing.
   */
  select(
    currentPriceCents: number,
    state: GridState,
    topN: number = 3,
  ): GridCandidate[] {
    if (state.stopped) return [];

    const crossing = this.calculator.detectCrossing(
      state.levels,
      state.lastPriceCents,
      currentPriceCents,
    );
    if (!crossing || !crossing.actionable) return [];

    // Compute order size
    const orderSize = this.calculator.computeOrderSizeCents(
      crossing,
      state.activeExposureCents,
      state.config,
    );
    if (orderSize <= 0) return [];

    // Estimate profit
    const profit = this.calculator.estimateProfitCents(
      crossing,
      orderSize,
      state.levels,
    );

    // Risk assessment
    const riskFactors: GridRiskFactors = {
      exposureRatioBps: state.config.capitalCents > 0
        ? Math.floor((state.activeExposureCents * 10000) / state.config.capitalCents)
        : 0,
      volatilityBps: 150,
      volatilityAvailable: true,
      distanceToStopCents: this.distanceToStop(crossing.level.priceCents, state.config),
    };

    const risk: GridRiskAssessment = this.riskModel.assess(riskFactors);

    // Gas estimate (integer cents)
    const gasCents = 10;

    // Net benefit (integer cents, all-safe positive)
    const netBenefit = Math.max(0, profit - gasCents - Number(risk.adjustmentCents));

    // Determine action side
    const action = crossing.direction === 'UP' ? 'SELL' : 'BUY';

    // Reason text
    const reason = crossing.direction === 'UP'
      ? `Price crossed UP through level ${crossing.level.index} at $${(crossing.level.priceCents / 100).toFixed(2)}`
      : `Price crossed DOWN through level ${crossing.level.index} at $${(crossing.level.priceCents / 100).toFixed(2)}`;

    const candidate: GridCandidate = {
      action: action as 'BUY' | 'SELL',
      level: crossing.level,
      maxSizeCents: orderSize,
      estimatedProfitCents: profit,
      estimatedGasCents: gasCents,
      netBenefitCents: netBenefit,
      reason,
      riskLevel: risk.level,
      rank: 1,
    };

    // Add STOP candidate if conditions are triggered
    const candidates: GridCandidate[] = [candidate];

    if (this.calculator.shouldStop(currentPriceCents, state.config)) {
      candidates.push({
        action: 'STOP',
        level: crossing.level,
        maxSizeCents: 0,
        estimatedProfitCents: 0,
        estimatedGasCents: 0,
        netBenefitCents: 0,
        reason: `Price $${(currentPriceCents / 100).toFixed(2)} outside grid bounds $${(state.config.lowerPriceCents / 100).toFixed(2)}–$${(state.config.upperPriceCents / 100).toFixed(2)}`,
        riskLevel: 'HIGH',
        rank: 2,
      });
    }

    return candidates.slice(0, topN);
  }

  private distanceToStop(priceCents: number, config: GridConfig): number {
    const toLower = priceCents - config.lowerPriceCents;
    const toUpper = config.upperPriceCents - priceCents;
    return Math.min(toLower, toUpper);
  }
}