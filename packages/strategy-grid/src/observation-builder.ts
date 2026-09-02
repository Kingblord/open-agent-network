/**
 * M12 — GridObservationBuilder.
 *
 * Builds structured Observation objects for the AI from grid state and
 * candidates. Exposes only deterministic candidate facts — never raw
 * market data, execution parameters, or uncontrolled price information
 * the AI could misuse.
 *
 * UNIT SAFETY (fixes "current price 687.06 cents"): `currentPrice.display`
 * is now a USD-denominated string ("$687.06 USD") and `currentPrice.cents`
 * is documented as USD-cents. The crossing prices are rendered in USD
 * dollars (divided by 100) so the LLM can never mistake a dollar figure
 * for a cents figure when comparing against `upperPriceCents`.
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
        // USD dollars with an explicit unit so the model can never read
        // $687.06 as "687.06 cents" (the cause of the bogus PASS).
        display: `$${humanReadablePrice} USD`,
      },
      crossing: crossing
        ? {
            direction: crossing.direction,
            levelIndex: crossing.level.index,
            levelPriceUsd: crossing.level.priceCents / 100,
            previousPriceUsd: crossing.previousPriceCents / 100,
            currentPriceUsd: crossing.currentPriceCents / 100,
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
      id: `obs_grid_${agent.id}_${Date.now()}`,
      agentId: agent.id,
      type: 'grid_trading',
      observedAt: new Date().toISOString(),
      data: gridData,
    } as unknown as Observation;
  }
}