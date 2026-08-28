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
export declare class LpObservationBuilder {
    private readonly strategyId;
    private readonly calc;
    constructor(strategyId: string, calculator?: LpRangeCalculator);
    build(agent: Agent, pool: LpPoolState, position: LpPosition | null, candidates: LpRebalanceSignal[]): Observation;
}
//# sourceMappingURL=observation-builder.d.ts.map