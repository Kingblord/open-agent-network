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
                recentered: false,
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
        // A fixed grid becomes a permanent no-op after a strong trend. Recenter
        // deterministically around the live price instead of repeatedly asking the
        // AI to explain why a stale range cannot trade. Also clears the stopped
        // flag when auto-recenter is enabled so the grid resumes trading.
        let recentered = false;
        if (this.state.config.autoRecenterOnBreak !== false) {
            const { lowerPriceCents, upperPriceCents } = this.state.config;
            if (priceCents < lowerPriceCents || priceCents > upperPriceCents) {
                const width = Math.max(2, upperPriceCents - lowerPriceCents);
                const lower = Math.max(1, priceCents - Math.floor(width / 2));
                const upper = lower + width;
                const levels = this.calculator.generateLevels(lower, upper, this.state.config.gridCount, this.state.config.capitalCents, this.state.config.maxOrderSizeCents);
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
                    stopped: false, // auto-resume when recentering
                };
                recentered = true;
            }
        }
        // Detect crossing after any range rebuild. The rebuild itself is not a
        // trade; the next market move must cross a fresh level first.
        const crossing = this.calculator.detectCrossing(this.state.levels, this.state.lastPriceCents, priceCents);
        // Generate candidates
        const candidates = crossing
            ? this.selector.select(priceCents, this.state)
            : [];
        // Build observation
        const observation = this.observationBuilder.build(agent, this.state.config, this.state.levels, crossing, candidates, this.state.fills, priceCents, humanReadable, recentered);
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
    /** Validate grid config before first cycle. */
    async preflight(agent) {
        const config = this.configOverride;
        if (config) {
            const lower = config.lowerPriceCents ?? 0;
            const upper = config.upperPriceCents ?? 0;
            if (lower >= upper)
                return { ok: false, reason: 'Grid upper price must be above lower price' };
            if (config.gridCount && config.gridCount < 2)
                return { ok: false, reason: 'Grid count must be at least 2' };
            const capital = config.capitalCents ?? 0;
            if (capital <= 0)
                return { ok: false, reason: 'Grid capital must be positive' };
        }
        return { ok: true };
    }
}
export { GridCalculator, GridDataProvider, GridRiskModel, GridCandidateSelector, GridObservationBuilder };
//# sourceMappingURL=grid-strategy.js.map