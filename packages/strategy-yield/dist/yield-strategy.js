import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { normalizeStrategyDecision } from '@ban/agent-core';
import { YieldNormalizer } from './yield-normalizer.js';
import { YieldRiskModel } from './yield-risk-model.js';
import { YieldCandidateSelector } from './yield-candidate-selector.js';
import { ObservationBuilder } from './observation-builder.js';
import { canonicalizeYieldProposal } from './canonical-proposal.js';
function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function toString(value, fallback) {
    return typeof value === 'string' && value ? value : fallback;
}
/**
 * Normalize the network string the data provider understands. Task configs
 * store the human label 'BNB Smart Chain' (and the chainId), while the yield
 * data provider expects the canonical catalog id 'bnb-mainnet'. Accept both
 * (case/separator-insensitive); anything else fails back to bnb-mainnet.
 */
function canonicalNetwork(value) {
    const cleaned = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (cleaned === 'bnbmainnet' || cleaned === 'bnbsmartchain')
        return 'bnb-mainnet';
    return 'bnb-mainnet'; // only BSC mainnet is served — fail closed to catalog id
}
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
 *
 * Task-config threading: like grid, this strategy can receive the caller's
 * task-derived config (`config`) so a user-set network / topN actually drives
 * observe() instead of only hermetic constructor defaults.
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
    config;
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
        this.config = deps.config ?? null;
    }
    async observe(agent, _correlationId) {
        // Task-config knobs (fail-closed): fall back to constructor defaults when
        // the task row didn't set them — never fabricates a value. The network
        // label from a task ('BNB Smart Chain') is normalized to the canonical
        // catalog id the data provider serves ('bnb-mainnet').
        const network = this.config
            ? canonicalNetwork(toString(this.config.network, this.network))
            : this.network;
        const topN = this.config ? toNumber(this.config.topN, this.topN) : this.topN;
        const raw = await this.data.fetch(network);
        const normalized = this.normalizer.normalizeAll(raw);
        const riskAdjusted = this.riskModel.apply(normalized, agent.riskLevel);
        const candidates = this.selector.select(riskAdjusted);
        // SIMULATION HOOK (BAN_SIM_YIELD_APR / BAN_SIM_YIELD_TOKEN): injects a
        // fat, LIVE-price-realistic opportunity into the observation so an
        // operator can watch the FULL closed loop (observe → decide → policy →
        // build calldata → dry-run) against a simulated real-time opportunity.
        // The same pattern as __auditThrottle: a test-only env hook; NEVER set in
        // production. When the env var is absent the candidates are untouched.
        const simApr = process.env.BAN_SIM_YIELD_APR;
        const simToken = process.env.BAN_SIM_YIELD_TOKEN ?? '';
        if (simApr && Number(simApr) > 0 && simToken) {
            const token = simToken.toUpperCase();
            const net = this.network;
            // The simulated opportunity's risk must MATCH the agent's risk level so
            // the deterministic risk policy allows it (a LOW agent can only take
            // LOW-risk actions; MEDIUM would be honestly denied before execution).
            const agentRisk = String(agent.riskLevel ?? 'LOW').toUpperCase();
            const simRisk = agentRisk === 'HIGH' ? 'HIGH' : agentRisk === 'MEDIUM' ? 'MEDIUM' : 'LOW';
            const sim = this.observationBuilder.build(agent, [
                {
                    asset: token,
                    protocol: 'venus',
                    risk: simRisk,
                    tvlUsd: '1250000000',
                    grossYieldBps: Math.round(Number(simApr) * 100),
                    protocolFeeBps: 5,
                    swapCostBps: 5,
                    gasCostBps: 2,
                    slippageBps: 3,
                    riskAdjustmentBps: 10,
                    effectiveYieldBps: Math.round(Number(simApr) * 100) - 25,
                    rank: 0,
                },
            ], { topN });
            console.warn(`[yield-sim] INJECTED ${token} @ ${simApr}% APR (risk=${simRisk}, matches agent) — TEST HOOK ACTIVE (network=${net})`);
            return [sim];
        }
        return [this.observationBuilder.build(agent, candidates, { topN })];
    }
    async decide(observation, agent, hooks) {
        const capabilities = agent.capabilities.map((c) => c.id);
        // Pre-schema vocabulary normalization (INVEST/HARVEST → DEPOSIT/WITHDRAW…);
        // a directive becomes an honest PASS instead of a hard failure.
        const normalized = normalizeStrategyDecision(await this.brain.decide({
            agentId: agent.id,
            strategyId: this.strategyId,
            observations: [observation],
            capabilities,
        }));
        if (normalized === null)
            return null;
        const decision = normalized;
        const parsed = StrategyDecisionSchema.safeParse(decision);
        if (!parsed.success) {
            throw new BANError(ErrorCode.INTERNAL, `Strategy brain returned a malformed decision: ${parsed.error.message}`, {
                retryable: false,
            });
        }
        hooks?.onDecision?.(parsed.data);
        if (parsed.data.status !== 'ACT' || !parsed.data.proposal)
            return null;
        const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
        if (!proposal.success) {
            throw new BANError(ErrorCode.INTERNAL, `Strategy brain produced an invalid proposal.`, { retryable: false });
        }
        // Execution-critical fields are canonicalized from the verified BSC
        // deployment set and the observation's candidates — never model-authored
        // values. Returns null when no target resolves (honest no-op).
        //
        // USER-WALLET-AWARE: when the owner's personal wallet is known (threaded
        // through config.userWalletAddress by run-cycle), a DEPOSIT lands ON THE
        // OWNER's position (mintBehalf / supply onBehalfOf) — the agent pays, the
        // owner receives the yield-bearing tokens.
        const ownerWallet = (typeof this.config?.userWalletAddress === 'string' && this.config.userWalletAddress) ||
            null;
        // DETERMINISTIC DEPOSIT SIZE: the task's per-transaction USD budget
        // (maxTxUsd, set by the user on the task form) is the ONLY honest size —
        // the LLM's raw 'amount' is archived but never broadcast. Converted to
        // cents for the canonicalizer (which turns cents → underlying wei).
        const budgetUsd = Number(this.config?.maxTxUsd ?? 0);
        const depositUsdCents = Number.isFinite(budgetUsd) && budgetUsd > 0 ? Math.round(budgetUsd * 100) : null;
        return canonicalizeYieldProposal(proposal.data, observation, ownerWallet, depositUsdCents);
    }
    /** Validate yield config before first cycle. */
    async preflight(agent) {
        const network = this.config ? toString(this.config.network, this.network) : this.network;
        if (!network)
            return { ok: false, reason: 'Yield strategy requires a network identifier' };
        return { ok: true };
    }
}
