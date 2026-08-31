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
 */
import type { Agent, ActionProposal, Observation, StrategyDecision } from '@ban/schemas';
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { GridCalculator } from './grid-calculator.js';
import { GridDataProvider } from './grid-data-provider.js';
import { GridRiskModel } from './grid-risk-model.js';
import { GridCandidateSelector } from './grid-candidate-selector.js';
import { GridObservationBuilder } from './observation-builder.js';
import type { GridState, GridConfig, GridLevel, GridFill } from './types.js';

export interface GridStrategyDeps {
  strategyId?: string;
  brain: BrainAdapter;
  data: GridDataProvider;
  calculator?: GridCalculator;
  riskModel?: GridRiskModel;
  selector?: GridCandidateSelector;
  observationBuilder?: GridObservationBuilder;
}

export class GridStrategy implements StrategyEngine {
  private readonly strategyId: string;
  private readonly brain: BrainAdapter;
  private readonly data: GridDataProvider;
  private readonly calculator: GridCalculator;
  private readonly riskModel: GridRiskModel;
  private readonly selector: GridCandidateSelector;
  private readonly observationBuilder: GridObservationBuilder;

  /** In-memory grid state (will be replaced by Firestore persistence in M18). */
  private state: GridState | null = null;

  constructor(deps: GridStrategyDeps) {
    this.strategyId = deps.strategyId ?? 'grid-trading';
    this.brain = deps.brain;
    this.data = deps.data;
    this.calculator = deps.calculator ?? new GridCalculator();
    this.riskModel = deps.riskModel ?? new GridRiskModel();
    this.selector = deps.selector ?? new GridCandidateSelector({ calculator: this.calculator, riskModel: this.riskModel });
    this.observationBuilder = deps.observationBuilder ?? new GridObservationBuilder(this.strategyId);
  }

  async observe(agent: Agent, _correlationId: string): Promise<Observation[]> {
    // Initialize grid state if not yet created (from agent's strategy config)
    // For M12, we use a test config — in M18 this comes from Firestore.
    if (!this.state) {
      const config: GridConfig = {
        lowerPriceCents: 50000,
        upperPriceCents: 60000,
        gridCount: 5,
        capitalCents: 100000,
        maxOrderSizeCents: 50000,
        maxActiveExposureCents: 100000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      const levels = this.calculator.generateLevels(
        config.lowerPriceCents,
        config.upperPriceCents,
        config.gridCount,
        config.capitalCents,
        config.maxOrderSizeCents,
      );
      const { priceCents } = await this.data.fetchPriceCents('BNB');
      this.state = {
        config,
        levels,
        fills: [],
        activeExposureCents: 0,
        realizedPnlCents: 0,
        stopped: false,
        lastPriceCents: priceCents,
      };
    }

    // Fetch current price
    const { priceCents, humanReadable } = await this.data.fetchPriceCents('BNB');

    // Detect crossing
    const crossing = this.calculator.detectCrossing(
      this.state.levels,
      this.state.lastPriceCents,
      priceCents,
    );

    // Generate candidates
    const candidates = crossing
      ? this.selector.select(priceCents, this.state)
      : [];

    // Build observation
    const observation = this.observationBuilder.build(
      agent,
      this.state.config,
      this.state.levels,
      crossing,
      candidates,
      this.state.fills,
      priceCents,
      humanReadable,
    );

    return [observation];
  }

  async decide(observation: Observation, agent: Agent, hooks?: { onDecision?: (decision: StrategyDecision) => void }): Promise<ActionProposal | null> {
    const capabilities = agent.capabilities.map((c) => c.id);
    const decision = await this.brain.decide({
      agentId: agent.id,
      strategyId: this.strategyId,
      observations: [observation],
      capabilities,
    });

    const parsed = StrategyDecisionSchema.safeParse(decision);
    if (!parsed.success) {
      throw new BANError(
        ErrorCode.INTERNAL,
        `Grid strategy brain returned a malformed decision: ${parsed.error.message}`,
        { retryable: false },
      );
    }
    hooks?.onDecision?.(parsed.data);
    if (parsed.data.status !== 'ACT' || !parsed.data.proposal) return null;

    const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
    if (!proposal.success) {
      throw new BANError(
        ErrorCode.INTERNAL,
        `Grid strategy brain produced an invalid proposal.`,
        { retryable: false },
      );
    }
    return proposal.data;
  }

  /** Expose grid state for testing. */
  getState(): GridState | null {
    return this.state;
  }

  /** Allow tests to inject a custom state. */
  setState(state: GridState): void {
    this.state = state;
  }
}

export { GridCalculator, GridDataProvider, GridRiskModel, GridCandidateSelector, GridObservationBuilder };
export type { GridConfig, GridLevel, GridFill, GridState, GridCrossing, GridCandidate, GridAction } from './types.js';