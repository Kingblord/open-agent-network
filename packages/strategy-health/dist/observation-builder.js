/**
 * M10 — ObservationBuilder.
 *
 * Produces schema-valid, structured `Observation` objects containing ONLY
 * deterministic corrective-candidate facts — NOT raw adapter payloads and NO
 * execution parameters the AI could misuse. The observation exposes the health
 * snapshot (risk state, HF in integer cents, collateral/debt in integer cents
 * USD) plus the bounded candidate set, so the AI can reason and explain why it
 * chose/likely-selected a corrective action purely from curated facts.
 */
export class ObservationBuilder {
    strategyId;
    constructor(strategyId) {
        this.strategyId = strategyId;
    }
    build(agent, snapshot, candidates) {
        return {
            id: `obs_health_${agent.id}_${Date.now()}`,
            agentId: agent.id,
            type: 'health_factor',
            observedAt: new Date().toISOString(),
            data: {
                strategyId: this.strategyId,
                address: snapshot.address,
                protocol: snapshot.protocol,
                riskState: snapshot.riskState,
                healthFactorCents: snapshot.healthFactorCents,
                collateralCentsUsd: snapshot.collateralCentsUsd,
                debtCentsUsd: snapshot.debtCentsUsd,
                liquidationThresholdBps: snapshot.liquidationThresholdBps,
                currentLtvBps: snapshot.currentLtvBps,
                candidates: candidates.map((c) => ({
                    action: c.action,
                    protocol: c.protocol,
                    address: c.address,
                    targetState: c.targetState,
                    fromState: c.fromState,
                    amountCentsUsd: c.amountCentsUsd,
                    amountWei: c.amountWei,
                    // NEW: the underline the corrective action moves — the model should
                    // echo this instead of inventing an asset symbol.
                    denomination: c.denomination,
                    rank: c.rank,
                })),
                basis: 'Integer cents USD / integer bps; HF = collateral*threshold/debt.',
            },
        };
    }
}
