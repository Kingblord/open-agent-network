import type { Agent, ActionProposal, Observation, StrategyDecision } from '@ban/schemas';
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import type { StrategyEngine } from '@ban/agent-core';
import { normalizeStrategyDecision } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { HealthDataProvider } from './health-data-provider.js';
import { HealthFactorCalculator } from './health-factor-calculator.js';
import { HealthRiskModel } from './health-risk-model.js';
import { HealthCandidateSelector } from './health-candidate-selector.js';
import { ObservationBuilder } from './observation-builder.js';
import { canonicalizeHealthProposal } from './canonical-proposal.js';

export interface HealthStrategyDeps {
  strategyId?: string;
  brain: BrainAdapter;
  data: HealthDataProvider;
  calculator?: HealthFactorCalculator;
  riskModel?: HealthRiskModel;
  selector?: HealthCandidateSelector;
  observationBuilder?: ObservationBuilder;
  /** Task-config threading: same seam grid uses — optional bounds/knobs the user set on the task. */
  config?: Record<string, unknown>;
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
 *
 * Task-config threading: like grid, this strategy can receive the caller's
 * task-derived config so the user's allowed contracts/tokens drive the health
 * snapshot instead of empty defaults.
 */
export class HealthStrategy implements StrategyEngine {
  private readonly strategyId: string;
  private readonly brain: BrainAdapter;
  private readonly data: HealthDataProvider;
  private readonly calculator: HealthFactorCalculator;
  private readonly riskModel: HealthRiskModel;
  private readonly selector: HealthCandidateSelector;
  private readonly observationBuilder: ObservationBuilder;
  private readonly config: Record<string, unknown> | null;

  constructor(deps: HealthStrategyDeps) {
    this.strategyId = deps.strategyId ?? 'health-factor-monitor';
    this.brain = deps.brain;
    this.data = deps.data;
    this.calculator = deps.calculator ?? new HealthFactorCalculator();
    this.riskModel = deps.riskModel ?? new HealthRiskModel();
    this.selector = deps.selector ?? new HealthCandidateSelector(this.calculator);
    this.observationBuilder = deps.observationBuilder ?? new ObservationBuilder(this.strategyId);
    this.config = deps.config ?? null;
  }

  async observe(agent: Agent, _correlationId: string): Promise<Observation[]> {
    // Task-config threading (fail-closed): when the user's task row carries
    // allowed contracts/tokens, feed them into the health snapshot so the
    // monitor actually watches the user's positions — never fabricates.
    const allowedContracts = Array.isArray(this.config?.allowedContracts)
      ? (this.config!.allowedContracts as string[])
      : [];
    const allowedTokens = Array.isArray(this.config?.allowedTokens)
      ? (this.config!.allowedTokens as string[])
      : [];
    // REAL-FUNDS visibility: the health monitor watches the OWNER's personal
    // wallet (the one holding their vUSDT collateral / Venus debt), never the
    // agent's own (usually empty) operational wallet. run-cycle threads the
    // owner's linked address in via config.userWalletAddress.
    const watchAddress =
      (typeof this.config?.userWalletAddress === 'string' && this.config!.userWalletAddress) ||
      agent.walletAddress ||
      '';
    const snapshot = await this.data.fetch(watchAddress, agent.protocols[0] ?? '', allowedContracts, allowedTokens);
    const candidates = this.selector.select(snapshot);
    return [this.observationBuilder.build(agent, snapshot, candidates)];
  }

  async decide(observation: Observation, agent: Agent, hooks?: { onDecision?: (decision: StrategyDecision) => void }): Promise<ActionProposal | null> {
    const capabilities = agent.capabilities.map((c) => c.id);
    // Pre-schema vocabulary normalization (REPAY/ADD_COLLATERAL → DEPOSIT…);
    // a directive becomes an honest PASS instead of a hard failure.
    const normalized = normalizeStrategyDecision(
      await this.brain.decide({
        agentId: agent.id,
        strategyId: this.strategyId,
        observations: [observation],
        capabilities,
      }),
    );
    if (normalized === null) return null;
    const decision = normalized;

    const parsed = StrategyDecisionSchema.safeParse(decision);
    if (!parsed.success) {
      throw new BANError(ErrorCode.INTERNAL, `Health strategy brain returned a malformed decision: ${parsed.error.message}`, {
        retryable: false,
      });
    }
    hooks?.onDecision?.(parsed.data);
    if (parsed.data.status !== 'ACT' || !parsed.data.proposal) return null;

    const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
    if (!proposal.success) {
      throw new BANError(ErrorCode.INTERNAL, `Health strategy brain produced an invalid proposal.`, { retryable: false });
    }
    // Execution-critical fields are canonicalized from verified Venus constants
    // and the observation's candidates — never model-authored values. Returns
    // null when there is no executable corrective candidate (honest no-op).
    return canonicalizeHealthProposal(proposal.data, observation);
  }

  /** Validate health config before first cycle. */
  async preflight(agent: Agent): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!agent.walletAddress && !agent.ownerId) {
      return { ok: false, reason: 'Health strategy requires a wallet address to monitor' };
    }
    return { ok: true };
  }
}