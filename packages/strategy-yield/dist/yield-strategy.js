import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { YieldNormalizer } from './yield-normalizer.js';
import { YieldRiskModel } from './yield-risk-model.js';
import { YieldCandidateSelector } from './yield-candidate-selector.js';
import { ObservationBuilder } from './observation-builder.js';
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
export class YieldStrategy {
    network;
    strategyId;
    topN;
    brain;
    data;
    normalizer;
    riskModel;
    selector;
    observationBuilder;
    constructor(deps) {
        this.network = deps.network ?? 'bnb-testnet';
        this.strategyId = deps.strategyId ?? 'yield-optimisation';
        this.topN = deps.topN ?? 3;
        this.brain = deps.brain;
        this.data = deps.data;
        this.normalizer = deps.normalizer ?? new YieldNormalizer();
        this.riskModel = deps.riskModel ?? new YieldRiskModel();
        this.selector = deps.selector ?? new YieldCandidateSelector(this.topN);
        this.observationBuilder = deps.observationBuilder ?? new ObservationBuilder(this.network, this.strategyId);
    }
    async observe(agent, _correlationId) {
        const raw = await this.data.fetch(this.network);
        const normalized = this.normalizer.normalizeAll(raw);
        const riskAdjusted = this.riskModel.apply(normalized, agent.riskLevel);
        const candidates = this.selector.select(riskAdjusted);
        return [this.observationBuilder.build(agent, candidates, { topN: this.topN })];
    }
    async decide(observation, agent) {
        const capabilities = agent.capabilities.map((c) => c.id);
        const decision = await this.brain.decide({
            agentId: agent.id,
            strategyId: this.strategyId,
            observations: [observation],
            capabilities,
        });
        const parsed = StrategyDecisionSchema.safeParse(decision);
        if (!parsed.success) {
            throw new BANError(ErrorCode.INTERNAL, `Strategy brain returned a malformed decision: ${parsed.error.message}`, {
                retryable: false,
            });
        }
        if (parsed.data.status !== 'ACT' || !parsed.data.proposal)
            return null;
        const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
        if (!proposal.success) {
            throw new BANError(ErrorCode.INTERNAL, `Strategy brain produced an invalid proposal.`, { retryable: false });
        }
        // The proposal is described but NOT executed inside M9. Policy/execution
        // happen only in the M18 live orchestration after this returns.
        return proposal.data;
    }
}
