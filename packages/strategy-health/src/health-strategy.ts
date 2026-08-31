import type { Agent, ActionProposal, Observation, StrategyDecision } from '@ban/schemas';
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
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
export class HealthStrategy implements StrategyEngine {
  private readonly strategyId: string;
  private readonly brain: BrainAdapter;
  private readonly data: HealthDataProvider;
  private readonly calculator: HealthFactorCalculator;
  private readonly riskModel: HealthRiskModel;
  private readonly selector: HealthCandidateSelector;
  private readonly observationBuilder: ObservationBuilder;

  constructor(deps: HealthStrategyDeps) {
    this.strategyId = deps.strategyId ?? 'health-factor-monitor';
    this.brain = deps.brain;
    this.data = deps.data;
    this.calculator = deps.calculator ?? new HealthFactorCalculator();
    this.riskModel = deps.riskModel ?? new HealthRiskModel();
    this.selector = deps.selector ?? new HealthCandidateSelector(this.calculator);
    this.observationBuilder = deps.observationBuilder ?? new ObservationBuilder(this.strategyId);
  }

  async observe(agent: Agent, _correlationId: string): Promise<Observation[]> {
    // M10 calls the strategy-relevant corrective candidates for the position.
    // (address/protocol/assets resolved from the agent in the live loop; for the
    // hermetic unit path a concrete snapshot is provided by tests.)
    const snapshot = await this.data.fetch(agent.walletAddress ?? '', agent.protocols[0] ?? '', [], []);
    const candidates = this.selector.select(snapshot);
    return [this.observationBuilder.build(agent, snapshot, candidates)];
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
    // Proposal is described but NOT executed. Policy/execution happen only in
    // the M18 live orchestration after this returns (M5 → M8 → Altana → BNB).
    return proposal.data;
  }
}