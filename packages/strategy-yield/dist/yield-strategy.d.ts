import type { Agent, ActionProposal, Observation } from '@ban/schemas';
import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { YieldDataProvider } from './yield-data-provider.js';
import { YieldNormalizer } from './yield-normalizer.js';
import { YieldRiskModel } from './yield-risk-model.js';
import { YieldCandidateSelector } from './yield-candidate-selector.js';
import { ObservationBuilder } from './observation-builder.js';
export interface YieldStrategyDeps {
    network?: string;
    strategyId?: string;
    topN?: number;
    brain: BrainAdapter;
    data: YieldDataProvider;
    normalizer?: YieldNormalizer;
    riskModel?: YieldRiskModel;
    selector?: YieldCandidateSelector;
    observationBuilder?: ObservationBuilder;
}
/**
 * M9 — YieldStrategy (implements @ban/agent-core StrategyEngine).
 *
 * observe()  → deterministic opportunity analysis → curated Observation[]
 * decide()   → delegates to the injected BrainAdapter (reasoning ONLY) and
 *              re-validates the returned StrategyDecision/ActionProposal.
 *
 * It does NOT invoke the PolicyEngine or ExecutionEngine — the y-proposal is
 * returned STILL-UNEXECUTED for M5/M8/live-loop in M18. All reasoning closes
 * to a schema-valid proposal that fails closed on malformed brain output.
 */
export declare class YieldStrategy implements StrategyEngine {
    private readonly network;
    private readonly strategyId;
    private readonly topN;
    private readonly brain;
    private readonly data;
    private readonly normalizer;
    private readonly riskModel;
    private readonly selector;
    private readonly observationBuilder;
    constructor(deps: YieldStrategyDeps);
    observe(agent: Agent, _correlationId: string): Promise<Observation[]>;
    decide(observation: Observation, agent: Agent): Promise<ActionProposal | null>;
}
//# sourceMappingURL=yield-strategy.d.ts.map