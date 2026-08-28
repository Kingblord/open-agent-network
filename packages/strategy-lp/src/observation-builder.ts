/**
 * M11 — ObservationBuilder.
 *
 * Produces schema-valid, structured `Observation` objects containing ONLY
 * deterministic LP candidate facts — NOT raw LiquidityAdapter payloads and NO
 * execution parameters the AI could misuse.
 *
 * Each observation exposes:
 *   - Pool state (tick, sqrtPriceX96, fee, volume — all integer/bps)
 *   - Current position state (range, in/out of range, fees earned)
 *   - Bounded candidate set (range ticks, netProfit, riskLevel — NOT raw ticks/liquidity)
 *
 * The AI receives ONLY the predetermined candidate facts. It NEVER generates:
 *   - lowerTick / upperTick
 *   - tickSpacing
 *   - arbitrary liquidity values
 *   - contract parameters
 */

import type { Agent, Observation } from '@ban/schemas';
import type { LpPoolState, LpPosition, LpRebalanceSignal } from './types.js';
import { LpRangeCalculator } from './lp-calculator.js';

export class LpObservationBuilder {
  private readonly calc: LpRangeCalculator;

  constructor(
    private readonly strategyId: string,
    calculator?: LpRangeCalculator,
  ) {
    this.calc = calculator ?? new LpRangeCalculator();
  }

  build(
    agent: Agent,
    pool: LpPoolState,
    position: LpPosition | null,
    candidates: LpRebalanceSignal[],
  ): Observation {
    const inRange = position
      ? this.calc.isInRange(pool.tick, position.lowerTick, position.upperTick)
      : false;

    return {
      id: `obs_lp_${agent.id}_${Date.now()}`,
      agentId: agent.id,
      type: 'lp_rebalance',
      observedAt: new Date().toISOString(),
      data: {
        strategyId: this.strategyId,
        poolAddress: pool.poolAddress,
        token0: pool.token0,
        token1: pool.token1,
        token0PriceUsd: pool.token0PriceUsd,
        token1PriceUsd: pool.token1PriceUsd,
        feeBps: pool.feeBps,
        tick: pool.tick,
        sqrtPriceX96: pool.sqrtPriceX96,
        liquidity: pool.liquidity,
        volumeUsdCents: pool.volumeUsdCents,
        position: position
          ? {
              positionId: position.positionId,
              lowerTick: position.lowerTick,
              upperTick: position.upperTick,
              inRange,
              liquidity: position.liquidity,
              feesUsd: position.feesUsd,
              token0Amount: position.token0Amount,
              token1Amount: position.token1Amount,
            }
          : null,
        candidates: candidates.map((c) => ({
          action: c.action,
          lowerTick: c.lowerTick,
          upperTick: c.upperTick,
          reason: c.reason,
          feesUsd: c.feesUsd,
          estimatedGasUsd: c.estimatedGasUsd,
          estimatedSlippageUsd: c.estimatedSlippageUsd,
          netProfitUsd: c.netProfitUsd,
          riskLevel: c.riskLevel,
          rank: c.rank,
        })),
        basis: 'Integer cents USD / integer ticks; ranges generated deterministically by LpRangeCalculator.',
      },
    };
  }
}