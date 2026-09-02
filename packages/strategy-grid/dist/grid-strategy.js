import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { GridCalculator } from './grid-calculator.js';
import { GridDataProvider } from './grid-data-provider.js';
import { GridRiskModel } from './grid-risk-model.js';
import { GridCandidateSelector } from './grid-candidate-selector.js';
import { GridObservationBuilder } from './observation-builder.js';
export class GridStrategy {
    strategyId;
    brain;
    data;
    calculator;
    riskModel;
    selector;
    observationBuilder;
    configOverride;
    /** In-memory grid state (will be replaced by Firestore persistence in M18). */
    state = null;
    constructor(deps) {
        this.strategyId = deps.strategyId ?? 'grid-trading';
        this.brain = deps.brain;
        this.data = deps.data;
        this.calculator = deps.calculator ?? new GridCalculator();
        this.riskModel = deps.riskModel ?? new GridRiskModel();
        this.selector = deps.selector ?? new GridCandidateSelector({ calculator: this.calculator, riskModel: this.riskModel });
        this.observationBuilder = deps.observationBuilder ?? new GridObservationBuilder(this.strategyId);
        this.configOverride = deps.config ?? null;
    }
    async observe(agent, _correlationId) {
        // Initialize grid state from the task-derived config when the caller
        // provided one (run-cycle threads the task row's grid bounds here).
        // Fall back to the M12 hermetic test config ONLY when nothing was passed.
        if (!this.state) {
            const config = {
                lowerPriceCents: 50000,
                upperPriceCents: 60000,
                gridCount: 5,
                capitalCents: 100000,
                maxOrderSizeCents: 50000,
                maxActiveExposureCents: 100000,
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
            const levels = this.calculator.generateLevels(config.lowerPriceCents, config.upperPriceCents, config.gridCount, config.capitalCents, config.maxOrderSizeCents);
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
        else if (this.configOverride) {
            // The task config changed between cycles (edit-session / new task):
            // rebuild levels from the merged bounds instead of silently keeping
            // stale levels computed for the old range.
            const nextConfig = {
                ...this.state.config,
                ...(this.configOverride ?? {}),
            };
            if (nextConfig.lowerPriceCents >= nextConfig.upperPriceCents) {
                nextConfig.upperPriceCents = nextConfig.lowerPriceCents + 1;
            }
            if (JSON.stringify(nextConfig) !== JSON.stringify(this.state.config)) {
                const levels = this.calculator.generateLevels(nextConfig.lowerPriceCents, nextConfig.upperPriceCents, nextConfig.gridCount, nextConfig.capitalCents, nextConfig.maxOrderSizeCents);
                this.state = { ...this.state, config: nextConfig, levels };
            }
        }
        // Fetch current price
        const { priceCents, humanReadable } = await this.data.fetchPriceCents('BNB');
        // Detect crossing
        const crossing = this.calculator.detectCrossing(this.state.levels, this.state.lastPriceCents, priceCents);
        // Generate candidates
        const candidates = crossing
            ? this.selector.select(priceCents, this.state)
            : [];
        // Build observation
        const observation = this.observationBuilder.build(agent, this.state.config, this.state.levels, crossing, candidates, this.state.fills, priceCents, humanReadable);
        return [observation];
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
            throw new BANError(ErrorCode.INTERNAL, `Grid strategy brain returned a malformed decision: ${parsed.error.message}`, { retryable: false });
        }
        hooks?.onDecision?.(parsed.data);
        if (parsed.data.status !== 'ACT' || !parsed.data.proposal)
            return null;
        const proposal = ActionProposalSchema.safeParse(parsed.data.proposal);
        if (!proposal.success) {
            throw new BANError(ErrorCode.INTERNAL, `Grid strategy brain produced an invalid proposal.`, { retryable: false });
        }
        return proposal.data;
    }
    /** Expose grid state for testing. */
    getState() {
        return this.state;
    }
    /** Allow tests to inject a custom state. */
    setState(state) {
        this.state = state;
    }
}
export { GridCalculator, GridDataProvider, GridRiskModel, GridCandidateSelector, GridObservationBuilder };
//# sourceMappingURL=grid-strategy.js.map