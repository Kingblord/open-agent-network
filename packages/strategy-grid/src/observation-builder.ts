/**
 * M12 — GridObservationBuilder.
 *
 * Builds structured Observation objects for the AI from grid state and
 * candidates. Exposes only deterministic candidate facts — never raw
 * market data, execution parameters, or uncontrolled price information
 * the AI could misuse.
 */
import type { Agent, Observation } from '@ban/schemas';
import type { GridConfig, GridLevel, GridCrossing, GridCandidate, GridFill, GridState } from './types.js';

export class GridObservationBuilder {
  private readonly strategyId: string;

  constructor(strategyId: string = 'grid-trading') {
    this.strategyId = strategyId;
  }

  build(
    agent: Agent,
    config: GridConfig,
    levels: GridLevel[],
    crossing: GridCrossing | null,
    candidates: GridCandidate[],
    fills: GridFill[],
    currentPriceCents: number,
    humanReadablePrice: string,
  ): Observation {
    const gridData = {
      config: {
        lowerPriceCents: config.lowerPriceCents,
        upperPriceCents: config.upperPriceCents,
        gridCount: config.gridCount,
        capitalCents: config.capitalCents,
        maxOrderSizeCents: config.maxOrderSizeCents,
        maxActiveExposureCents: config.maxActiveExposureCents,
        expiresAt: config.expiresAt,
      },
      currentPrice: {
        cents: currentPriceCents,
        display: humanReadablePrice,
      },
      crossing: crossing
        ? {
            direction: crossing.direction,
            levelIndex: crossing.level.index,
            levelPrice: crossing.level.priceCents / 100,
            previousPrice: crossing.previousPriceCents / 100,
            currentPrice: crossing.currentPriceCents / 100,
          }
        : null,
      candidates: candidates.map((c) => ({
        action: c.action,
        levelIndex: c.level.index,
        priceCents: c.level.priceCents,
        maxSizeCents: c.maxSizeCents,
        estimatedProfitCents: c.estimatedProfitCents,
        estimatedGasCents: c.estimatedGasCents,
        netBenefitCents: c.netBenefitCents,
        riskLevel: c.riskLevel,
        rank: c.rank,
        reason: c.reason,
      })),
      filledLevels: fills.map((f) => ({
        levelIndex: f.levelIndex,
        side: f.side,
        sizeCents: f.sizeCents,
        filledAt: f.filledAt,
      })),
    };

    return {
      type: 'grid_trading',
      agentId: agent.id,
      strategyId: this.strategyId,
      timestamp: new Date().toISOString(),
      data: gridData,
    } as unknown as Observation;
  }
}