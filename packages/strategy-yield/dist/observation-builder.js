/**
 * M9 — ObservationBuilder.
 *
 * Produces schema-valid, structured `Observation` objects containing ONLY
 * deterministic candidate facts — NOT raw market data and NOT execution
 * parameters the AI could abuse. The observation carries enough component
 * detail for the AI to explain which opportunity it prefers and why the
 * alternatives were worse (per-candidate cost breakdown).
 */
export class ObservationBuilder {
    network;
    strategyId;
    constructor(network, strategyId) {
        this.network = network;
        this.strategyId = strategyId;
    }
    build(agent, candidates, constraints) {
        // Rejected/enriched facts live here; deliberately no raw adapter payload.
        const detailed = candidates.map((c) => ({
            asset: c.asset,
            protocol: c.protocol,
            rank: c.rank,
            risk: c.risk,
            effectiveYieldBps: c.effectiveYieldBps,
            grossYieldBps: c.grossYieldBps,
            protocolFeeBps: c.protocolFeeBps,
            swapCostBps: c.swapCostBps,
            gasCostBps: c.gasCostBps,
            slippageBps: c.slippageBps,
            riskAdjustmentBps: c.riskAdjustmentBps,
            tvlUsd: c.tvlUsd,
        }));
        return {
            id: `obs_yield_${agent.id}_${Date.now()}`,
            agentId: agent.id,
            type: 'yield_opportunities',
            observedAt: new Date().toISOString(),
            data: {
                network: this.network,
                strategyId: this.strategyId,
                topN: constraints.topN,
                candidates: detailed,
                basis: 'Integer bps; effective = gross − fees − swap − gas − slippage − risk adj.',
            },
        };
    }
}
