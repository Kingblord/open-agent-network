import type { Agent, Observation } from '@ban/schemas';
import type { YieldCandidate } from './types.js';
/**
 * M9 — ObservationBuilder.
 *
 * Produces schema-valid, structured `Observation` objects containing ONLY
 * deterministic candidate facts — NOT raw market data and NOT execution
 * parameters the AI could abuse. The observation carries enough component
 * detail for the AI to explain which opportunity it prefers and why the
 * alternatives were worse (per-candidate cost breakdown).
 */
export declare class ObservationBuilder {
    private readonly network;
    private readonly strategyId;
    constructor(network: string, strategyId: string);
    build(agent: Agent, candidates: YieldCandidate[], constraints: {
        topN: number;
    }): Observation;
}
//# sourceMappingURL=observation-builder.d.ts.map