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
 */
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { LpRangeCalculator } from './lp-calculator.js';
import { LpRiskModel } from './lp-risk-model.js';
import { LpCandidateSelector } from './lp-candidate-selector.js';
import { LpObservationBuilder } from './observation-builder.js';
export class LpStrategy {
    strategyId;
    brain;
    data;
    calculator;
    riskModel;
    selector;
    observationBuilder;
    constructor(deps) {
        this.strategyId = deps.strategyId ?? 'lp-rebalance';
        this.brain = deps.brain;
        this.data = deps.data;
        this.calculator = deps.calculator ?? new LpRangeCalculator();
        this.riskModel = deps.riskModel ?? new LpRiskModel();
        this.selector = deps.selector ?? new LpCandidateSelector({ calculator: this.calculator, riskModel: this.riskModel });
        this.observationBuilder = deps.observationBuilder ?? new LpObservationBuilder(this.strategyId, this.calculator);
    }
    async observe(agent, _correlationId) {
        // In the live agent loop, the pool address and owner are resolved from the
        // agent's protocol portfolio. For the hermetic unit path a concrete pool
        // and position are provided by tests.
        const poolAddress = agent.protocols[0] ?? '';
        const walletAddress = agent.walletAddress ?? '';
        const pool = await this.data.fetchPoolState(poolAddress, 18, 18);
        let position = null;
        try {
            position = await this.data.fetchPosition(poolAddress, walletAddress);
        }
        catch {
            // No existing position — CREATE candidate only
        }
        const candidates = this.selector.select(pool, position);
        return [this.observationBuilder.build(agent, pool, position, candidates)];
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
            throw new BANError(ErrorCode.INTERNAL, `LP strategy brain returned a malformed decision: ${parsed.error.message}`, { retryable: false });
        }
        if (parsed.data.status !== 'ACT' || !parsed.data.proposal)
            return null;
        const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
        if (!proposal.success) {
            throw new BANError(ErrorCode.INTERNAL, `LP strategy brain produced an invalid proposal.`, { retryable: false });
        }
        // Proposal is described but NOT executed. Policy/execution happen only in
        // the M18 live orchestration.
        return proposal.data;
    }
}
