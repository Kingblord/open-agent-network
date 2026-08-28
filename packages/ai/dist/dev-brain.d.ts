import type { Observation, StrategyDecision } from '@ban/schemas';
import type { BrainAdapter } from './brain.js';
/**
 * M7 — Deterministic DevBrainAdapter (Rule 7: explicit dev/test provider).
 *
 * Drives the SAME reasoning→decision path a live LLM would, but with a
 * deterministic, in-process policy so tests are hermetic and reproducible.
 * It does NOT claim to be intelligent; it proves the contract:
 *   - consumes structured observations,
 *   - can emit a strict, schema-valid `ACT` proposal when prompted (only when
 *     a valid action is requested and the agent holds the capability),
 *   - otherwise falls back to `PASS` with a reason (fail-closed).
 *
 * The REASONING is trivial and deterministic; the important, testable invariant
 * is that ANY decision it returns satisfies `StrategyDecisionSchema` and any
 * `proposal` satisfies `ActionProposalSchema`.
 */
export interface DevBrainConfig {
    /** When set, decide() emits an ACT proposal for this capability. */
    actCapability?: string;
    /** When set, decide() ALWAYS fails closed with PASS + this deniedReason. */
    alwaysDenyReason?: string;
}
export declare class DevBrainAdapter implements BrainAdapter {
    private readonly config;
    constructor(config?: DevBrainConfig);
    decide(input: {
        agentId: string;
        strategyId?: string;
        observations: Observation[];
        capabilities: string[];
    }): Promise<StrategyDecision>;
}
//# sourceMappingURL=dev-brain.d.ts.map