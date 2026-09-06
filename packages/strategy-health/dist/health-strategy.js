import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { HealthFactorCalculator } from './health-factor-calculator.js';
import { HealthRiskModel } from './health-risk-model.js';
import { HealthCandidateSelector } from './health-candidate-selector.js';
import { ObservationBuilder } from './observation-builder.js';
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
export class HealthStrategy {
    strategyId;
    brain;
    data;
    calculator;
    riskModel;
    selector;
    observationBuilder;
    config;
    constructor(deps) {
        this.strategyId = deps.strategyId ?? 'health-factor-monitor';
        this.brain = deps.brain;
        this.data = deps.data;
        this.calculator = deps.calculator ?? new HealthFactorCalculator();
        this.riskModel = deps.riskModel ?? new HealthRiskModel();
        this.selector = deps.selector ?? new HealthCandidateSelector(this.calculator);
        this.observationBuilder = deps.observationBuilder ?? new ObservationBuilder(this.strategyId);
        this.config = deps.config ?? null;
    }
    async observe(agent, _correlationId) {
        // Task-config threading (fail-closed): when the user's task row carries
        // allowed contracts/tokens, feed them into the health snapshot so the
        // monitor actually watches the user's positions — never fabricates.
        const allowedContracts = Array.isArray(this.config?.allowedContracts)
            ? this.config.allowedContracts
            : [];
        const allowedTokens = Array.isArray(this.config?.allowedTokens)
            ? this.config.allowedTokens
            : [];
        const snapshot = await this.data.fetch(agent.walletAddress ?? '', agent.protocols[0] ?? '', allowedContracts, allowedTokens);
        const candidates = this.selector.select(snapshot);
        return [this.observationBuilder.build(agent, snapshot, candidates)];
    }
    async decide(observation, agent, hooks) {
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
        if (parsed.data.status !== 'ACT' || !parsed.data.proposal)
            return null;
        const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
        if (!proposal.success) {
            throw new BANError(ErrorCode.INTERNAL, `Health strategy brain produced an invalid proposal.`, { retryable: false });
        }
        // Proposal is described but NOT executed. Policy/execution happen only in
        // the M18 live orchestration after this returns (M5 → M8 → Altana → BNB).
        return proposal.data;
    }
    /** Validate health config before first cycle. */
    async preflight(agent) {
        if (!agent.walletAddress && !agent.ownerId) {
            return { ok: false, reason: 'Health strategy requires a wallet address to monitor' };
        }
        return { ok: true };
    }
}
