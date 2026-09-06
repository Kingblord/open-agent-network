/**
 * M12 — GridStrategy (implements @ban/agent-core StrategyEngine).
 *
 * observe() → deterministic grid price observation → crossing analysis →
 *             bounded candidates → structured Observation[].
 * decide()  → delegates to the injected BrainAdapter (reasoning ONLY) and
 *             re-validates the returned StrategyDecision/ActionProposal.
 *
 * It does NOT invoke PolicyEngine or ExecutionEngine — the proposal is
 * returned still-unexecuted for M5/M8/live-loop in M18.
 *
 * The AI receives only precomputed deterministic grid candidates — it
 * never generates price levels, order sizes, or stop conditions.
 *
 * Task-config threading (fixes "current price 687.06 cents"): the caller
 * (run-cycle) passes the user's task-derived bounds via `config` — real
 * lower/upper/gridCount/capital from the task row override the M12 test
 * defaults, so a task configured for e.g. $400–$900 actually trades that
 * range instead of always comparing BNB price against the hardcoded
 * $500–$600 test grid.
 */
import type { Agent, ActionProposal, Observation, StrategyDecision } from '@ban/schemas';
import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { GridCalculator } from './grid-calculator.js';
import { GridDataProvider } from './grid-data-provider.js';
import { GridRiskModel } from './grid-risk-model.js';
import { GridCandidateSelector } from './grid-candidate-selector.js';
import { GridObservationBuilder } from './observation-builder.js';
import type { GridState, GridConfig } from './types.js';
export interface GridStrategyDeps {
    strategyId?: string;
    brain: BrainAdapter;
    data: GridDataProvider;
    calculator?: GridCalculator;
    riskModel?: GridRiskModel;
    selector?: GridCandidateSelector;
    observationBuilder?: GridObservationBuilder;
    /** Task-derived config overrides (bounds/caps). Absent → M12 defaults. */
    config?: Partial<GridConfig>;
    /** Live volatility estimate in bps. Absent → 150 default. */
    volatilityBps?: number;
    /** Persisted grid state from a previous cycle (Firestore). Restored before observe. */
    persistedState?: GridState | null;
    /** Callback to persist grid state after each observe cycle. */
    onStateChanged?: (state: GridState) => void;
}
export declare class GridStrategy implements StrategyEngine {
    private readonly strategyId;
    private readonly brain;
    private readonly data;
    private readonly calculator;
    private readonly riskModel;
    private readonly selector;
    private readonly observationBuilder;
    private readonly configOverride;
    private readonly volatilityBps;
    private readonly onStateChanged;
    /** In-memory grid state (restored from persistedState on construction). */
    private state;
    constructor(deps: GridStrategyDeps);
    observe(agent: Agent, _correlationId: string): Promise<Observation[]>;
    decide(observation: Observation, agent: Agent, hooks?: {
        onDecision?: (decision: StrategyDecision) => void;
    }): Promise<ActionProposal | null>;
    /** Expose grid state for testing. */
    getState(): GridState | null;
    /** Allow tests to inject a custom state. */
    setState(state: GridState): void;
    /** Validate grid config before first cycle. */
    preflight(agent: Agent): Promise<{
        ok: true;
    } | {
        ok: false;
        reason: string;
    }>;
}
export { GridCalculator, GridDataProvider, GridRiskModel, GridCandidateSelector, GridObservationBuilder };
export type { GridConfig, GridLevel, GridFill, GridState, GridCrossing, GridCandidate, GridAction } from './types.js';
//# sourceMappingURL=grid-strategy.d.ts.map