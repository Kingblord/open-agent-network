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
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { isValidAddress } from '@ban/registry';
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

export class LpStrategy implements StrategyEngine {
  private readonly strategyId: string;
  private readonly brain: BrainAdapter;
  private readonly data: LpDataProvider;
  private readonly calculator: LpRangeCalculator;
  private readonly riskModel: LpRiskModel;
  private readonly selector: LpCandidateSelector;
  private readonly observationBuilder: LpObservationBuilder;
  private readonly config: Record<string, unknown> | null;

  constructor(deps: LpStrategyDeps) {
    this.strategyId = deps.strategyId ?? 'lp-rebalance';
    this.brain = deps.brain;
    this.data = deps.data;
    this.calculator = deps.calculator ?? new LpRangeCalculator();
    this.riskModel = deps.riskModel ?? new LpRiskModel();
    this.selector = deps.selector ?? new LpCandidateSelector({ calculator: this.calculator, riskModel: this.riskModel });
    this.observationBuilder = deps.observationBuilder ?? new LpObservationBuilder(this.strategyId, this.calculator);
    this.config = deps.config ?? null;
  }

  async observe(agent: Agent, _correlationId: string): Promise<Observation[]> {
    // In the live agent loop, the pool address and owner are resolved from the
    // agent's protocol portfolio. For the hermetic unit path a concrete pool
    // and position are provided by tests.
    // Task-config threading: a pool address is REQUIRED to observe (a real
    // PancakeSwap V3 pool). We accept only a structurally-valid address from
    // config.poolAddress (task row). We NEVER treat a protocol name like
    // "pancakeswap" as an address — that would throw a viem address error.
    // If no valid pool address is configured, fail closed with a clear,
    // actionable PROVIDER_UNAVAILABLE instead of contacting a guessed address.
    const rawPool =
      typeof this.config?.poolAddress === 'string' && this.config!.poolAddress
        ? (this.config!.poolAddress as string)
        : '';
    if (!isValidAddress(rawPool)) {
      throw new BANError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'LP strategy requires a real PancakeSwap V3 pool address in task config (config.poolAddress); none provided. Refusing to guess an address or read a protocol name as a pool.',
        { retryable: true },
      );
    }
    const poolAddress = rawPool;
    const walletAddress = agent.walletAddress ?? '';
    const pool = await this.data.fetchPoolState(poolAddress, 18, 18);
    let position: import('./types.js').LpPosition | null = null;
    try {
      position = await this.data.fetchPosition(poolAddress, walletAddress);
    } catch (err) {
      // Network/connection errors are distinguishable from "no position" by
      // checking the message. If the error is not a "no position" error we
      // re-throw so the cycle can surface the real issue.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no position') || message.includes('position not found') || message.includes('none')) {
        // No existing position — CREATE candidate only (valid state)
      } else {
        // Real network/contract error — re-throw
        throw err;
      }
    }

    const candidates = this.selector.select(pool, position);
    return [this.observationBuilder.build(agent, pool, position, candidates)];
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
        `LP strategy brain returned a malformed decision: ${parsed.error.message}`,
        { retryable: false },
      );
    }
    hooks?.onDecision?.(parsed.data);
    if (parsed.data.status !== 'ACT' || !parsed.data.proposal) return null;

    const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
    if (!proposal.success) {
      throw new BANError(
        ErrorCode.INTERNAL,
        `LP strategy brain produced an invalid proposal.`,
        { retryable: false },
      );
    }
    // Proposal is described but NOT executed. Policy/execution happen only in
    // the M18 live orchestration.
    return proposal.data;
  }

  /** Validate LP config before first cycle. */
  async preflight(agent: Agent): Promise<{ ok: true } | { ok: false; reason: string }> {
    const rawPool = typeof this.config?.poolAddress === 'string' ? (this.config.poolAddress as string) : '';
    if (!rawPool) return { ok: false, reason: 'LP strategy requires a PancakeSwap V3 pool address in task config (config.poolAddress)' };
    return { ok: true };
  }
}