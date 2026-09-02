export class GridObservationBuilder {
    strategyId;
    constructor(strategyId = 'grid-trading') {
        this.strategyId = strategyId;
    }
    build(agent, config, levels, crossing, candidates, fills, currentPriceCents, humanReadablePrice) {
        const gridData = {
            config: {
                lowerPriceCents: config.lowerPriceCents,
                upperPriceCents: config.upperPriceCents,
                gridCount: config.gridCount,
                capitalCents: config.capitalCents,
                maxOrderSizeCents: config.maxOrderSizeCents,
                maxActiveExposureCents: config.maxActiveExposureCents,
                expiresAt: config.expiresAt,
            },
            currentPrice: {
                cents: currentPriceCents,
                // USD dollars with an explicit unit so the model can never read
                // $687.06 as "687.06 cents" (the cause of the bogus PASS).
                display: `$${humanReadablePrice} USD`,
            },
            crossing: crossing
                ? {
                    direction: crossing.direction,
                    levelIndex: crossing.level.index,
                    levelPriceUsd: crossing.level.priceCents / 100,
                    previousPriceUsd: crossing.previousPriceCents / 100,
                    currentPriceUsd: crossing.currentPriceCents / 100,
                }
                : null,
            candidates: candidates.map((c) => ({
                action: c.action,
                levelIndex: c.level.index,
                priceCents: c.level.priceCents,
                maxSizeCents: c.maxSizeCents,
                estimatedProfitCents: c.estimatedProfitCents,
                estimatedGasCents: c.estimatedGasCents,
                netBenefitCents: c.netBenefitCents,
                riskLevel: c.riskLevel,
                rank: c.rank,
                reason: c.reason,
            })),
            filledLevels: fills.map((f) => ({
                levelIndex: f.levelIndex,
                side: f.side,
                sizeCents: f.sizeCents,
                filledAt: f.filledAt,
            })),
        };
        return {
            id: `obs_grid_${agent.id}_${Date.now()}`,
            agentId: agent.id,
            type: 'grid_trading',
            observedAt: new Date().toISOString(),
            data: gridData,
        };
    }
}
//# sourceMappingURL=observation-builder.js.map