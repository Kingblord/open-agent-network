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
import type { GridConfig, GridLevel, GridCrossing, GridCandidate, GridFill } from './types.js';
export declare class GridObservationBuilder {
    private readonly strategyId;
    constructor(strategyId?: string);
    build(agent: Agent, config: GridConfig, levels: GridLevel[], crossing: GridCrossing | null, candidates: GridCandidate[], fills: GridFill[], currentPriceCents: number, humanReadablePrice: string): Observation;
}
//# sourceMappingURL=observation-builder.d.ts.map