/**
 * M12 — GridObservationBuilder.
 *
 * Builds structured Observation objects for the AI from grid state and
 * candidates. Exposes only deterministic candidate facts — never raw
 * market data, execution parameters, or uncontrolled price information
 * the AI could misuse.
 */
import type { Agent, Observation } from '@ban/schemas';
import type { GridConfig, GridLevel, GridCrossing, GridCandidate, GridFill } from './types.js';
export declare class GridObservationBuilder {
    private readonly strategyId;
    constructor(strategyId?: string);
    build(agent: Agent, config: GridConfig, levels: GridLevel[], crossing: GridCrossing | null, candidates: GridCandidate[], fills: GridFill[], currentPriceCents: number, humanReadablePrice: string): Observation;
}
//# sourceMappingURL=observation-builder.d.ts.map