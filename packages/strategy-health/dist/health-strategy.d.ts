import type { Agent, ActionProposal, Observation } from '@ban/schemas';
import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { HealthDataProvider } from './health-data-provider.js';
import { HealthFactorCalculator } from './health-factor-calculator.js';
import { HealthRiskModel } from './health-risk-model.js';
import { HealthCandidateSelector } from './health-candidate-selector.js';
import { ObservationBuilder } from './observation-builder.js';
export interface HealthStrategyDeps {
    strategyId?: string;
    brain: BrainAdapter;
    data: HealthDataProvider;
    calculator?: HealthFactorCalculator;
    riskModel?: HealthRiskModel;
    selector?: HealthCandidateSelector;
    observationBuilder?: ObservationBuilder;
}
/**
 * M10 — HealthStrategy (implements @ban/agent-core StrategyEngine).
 *
 * observe() → deterministic health-factor analysis → curated Observation[].
 * decide()  → delegates to the injected BrainAdapter (reasoning ONLY) and
 *             re-validates the returned StrategyDecision/ActionProposal.
 *
 * It does NOT invoke the PolicyEngine or ExecutionEngine — a corrective
 * proposal is returned STILL-UNEXECUTED for M5/M8/live-loop in M18. This mirrors
 * M9's YieldStrategy and keeps the AI a reasoning/selection layer only.
 */
export declare class HealthStrategy implements StrategyEngine {
    private readonly strategyId;
    private readonly brain;
    private readonly data;
    private readonly calculator;
    private readonly riskModel;
    private readonly selector;
    private readonly observationBuilder;
    constructor(deps: HealthStrategyDeps);
    observe(agent: Agent, _correlationId: string): Promise<Observation[]>;
    decide(observation: Observation, agent: Agent): Promise<ActionProposal | null>;
}
//# sourceMappingURL=health-strategy.d.ts.map