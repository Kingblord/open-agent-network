/**
 * M11 — LpStrategy (implements @ban/agent-core StrategyEngine).
 *
 * observe() → deterministic LP analysis → curated Observation[].
 * decide()  → delegates to the injected BrainAdapter (reasoning ONLY) and
 *             re-validates the returned StrategyDecision/ActionProposal.
 *
 * It does NOT invoke the PolicyEngine or ExecutionEngine — the proposal is
 * returned still-unexecuted for M5/M8/live-loop in M18.
 *
 * The AI receives only precomputed deterministic candidates — it never
 * generates ticks, liquidity amounts, or contract parameters.
 *
 * Task-config threading: like grid, this strategy can receive the caller's
 * task-derived config so a user-set pool address (or a protocol marker) drives
 * observe() instead of only the agent's first protocol.
 */
import type { Agent, ActionProposal, Observation, StrategyDecision } from '@ban/schemas';
import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { LpRangeCalculator } from './lp-calculator.js';
import { LpDataProvider } from './lp-data-provider.js';
import { LpRiskModel } from './lp-risk-model.js';
import { LpCandidateSelector } from './lp-candidate-selector.js';
import { LpObservationBuilder } from './observation-builder.js';
export interface LpStrategyDeps {
    strategyId?: string;
    brain: BrainAdapter;
    data: LpDataProvider;
    calculator?: LpRangeCalculator;
    riskModel?: LpRiskModel;
    selector?: LpCandidateSelector;
    observationBuilder?: LpObservationBuilder;
    /** Task-config threading: same seam grid uses — optional bounds/knobs the user set on the task. */
    config?: Record<string, unknown>;
}
export declare class LpStrategy implements StrategyEngine {
    private readonly strategyId;
    private readonly brain;
    private readonly data;
    private readonly calculator;
    private readonly riskModel;
    private readonly selector;
    private readonly observationBuilder;
    private readonly config;
    constructor(deps: LpStrategyDeps);
    observe(agent: Agent, _correlationId: string): Promise<Observation[]>;
    decide(observation: Observation, agent: Agent, hooks?: {
        onDecision?: (decision: StrategyDecision) => void;
    }): Promise<ActionProposal | null>;
    /** Validate LP config before first cycle. */
    preflight(agent: Agent): Promise<{
        ok: true;
    } | {
        ok: false;
        reason: string;
    }>;
}
//# sourceMappingURL=lp-strategy.d.ts.map