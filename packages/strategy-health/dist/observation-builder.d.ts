import type { Agent, Observation } from '@ban/schemas';
import type { HealthCandidate, HealthSnapshot } from './types.js';
/**
 * M10 — ObservationBuilder.
 *
 * Produces schema-valid, structured `Observation` objects containing ONLY
 * deterministic corrective-candidate facts — NOT raw adapter payloads and NO
 * execution parameters the AI could misuse. The observation exposes the health
 * snapshot (risk state, HF in integer cents, collateral/debt in integer cents
 * USD) plus the bounded candidate set, so the AI can reason and explain why it
 * chose/likely-selected a corrective action purely from curated facts.
 */
export declare class ObservationBuilder {
    private readonly strategyId;
    constructor(strategyId: string);
    build(agent: Agent, snapshot: HealthSnapshot, candidates: HealthCandidate[]): Observation;
}
//# sourceMappingURL=observation-builder.d.ts.map