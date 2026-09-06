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
  /** Task-derived config overrides (bounds/caps). Absent → M12 defaults. */
  config?: Partial<GridConfig>;
}

export class GridStrategy implements StrategyEngine {
  private readonly strategyId: string;
  private readonly brain: BrainAdapter;
  private readonly data: GridDataProvider;
  private readonly calculator: GridCalculator;
  private readonly riskModel: GridRiskModel;
  private readonly selector: GridCandidateSelector;
  private readonly observationBuilder: GridObservationBuilder;
  private readonly configOverride: Partial<GridConfig> | null;

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
    this.configOverride = deps.config ?? null;
  }

  async observe(agent: Agent, _correlationId: string): Promise<Observation[]> {
    // Initialize grid state from the task-derived config when the caller
    // provided one (run-cycle threads the task row's grid bounds here).
    // Fall back to the M12 hermetic test config ONLY when nothing was passed.
    if (!this.state) {
      const config: GridConfig = {
        lowerPriceCents: 50000,
        upperPriceCents: 60000,
        gridCount: 5,
        capitalCents: 100000,
        maxOrderSizeCents: 50000,
        maxActiveExposureCents: 100000,
        autoRecenterOnBreak: true,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        ...(this.configOverride ?? {}),
      };
      // Fail-closed: an invalid task range must never produce a broken grid.
      if (!Number.isFinite(config.lowerPriceCents) || !Number.isFinite(config.upperPriceCents)) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, 'Grid config bounds must be finite numbers', {
          retryable: false,
        });
      }
      if (config.lowerPriceCents >= config.upperPriceCents) {
        config.upperPriceCents = config.lowerPriceCents + 1;
      }
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
        recentered: false,
      };
    } else if (this.configOverride) {
      // The task config changed between cycles (edit-session / new task):
      // rebuild levels from the merged bounds instead of silently keeping
      // stale levels computed for the old range.
      const nextConfig: GridConfig = {
        ...this.state.config,
        ...(this.configOverride ?? {}),
      };
      if (nextConfig.lowerPriceCents >= nextConfig.upperPriceCents) {
        nextConfig.upperPriceCents = nextConfig.lowerPriceCents + 1;
      }
      if (JSON.stringify(nextConfig) !== JSON.stringify(this.state.config)) {
        const levels = this.calculator.generateLevels(
          nextConfig.lowerPriceCents,
          nextConfig.upperPriceCents,
          nextConfig.gridCount,
          nextConfig.capitalCents,
          nextConfig.maxOrderSizeCents,
        );
        this.state = { ...this.state, config: nextConfig, levels };
      }
    }

    // Fetch current price
    const { priceCents, humanReadable } = await this.data.fetchPriceCents('BNB');

    // A fixed grid becomes a permanent no-op after a strong trend. Recenter
    // deterministically around the live price instead of repeatedly asking the
    // AI to explain why a stale range cannot trade.
    let recentered = false;
    if (!this.state.stopped && this.state.config.autoRecenterOnBreak !== false) {
      const { lowerPriceCents, upperPriceCents } = this.state.config;
      if (priceCents < lowerPriceCents || priceCents > upperPriceCents) {
        const width = Math.max(2, upperPriceCents - lowerPriceCents);
        const lower = Math.max(1, priceCents - Math.floor(width / 2));
        const upper = lower + width;
        const levels = this.calculator.generateLevels(
          lower,
          upper,
          this.state.config.gridCount,
          this.state.config.capitalCents,
          this.state.config.maxOrderSizeCents,
        );
        this.state = {
          ...this.state,
          config: {
            ...this.state.config,
            lowerPriceCents: lower,
            upperPriceCents: upper,
          },
          levels,
          lastPriceCents: priceCents,
          recentered: true,
        };
        recentered = true;
      }
    }

    // Detect crossing after any range rebuild. The rebuild itself is not a
    // trade; the next market move must cross a fresh level first.
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
      recentered,
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