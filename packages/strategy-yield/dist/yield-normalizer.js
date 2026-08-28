export class YieldNormalizer {
    protocolFeeBps;
    swapCostBps;
    gasCostBps;
    slippageBps;
    constructor(cfg = {}) {
        this.protocolFeeBps = cfg.protocolFeeBps ?? {};
        this.swapCostBps = cfg.swapCostBps ?? 25;
        this.gasCostBps = cfg.gasCostBps ?? 5;
        this.slippageBps = cfg.slippageBps ?? 30;
    }
    /**
     * Normalize a single raw opportunity into its component cost. Risk
     * adjustment is applied separately by YieldRiskModel; `effectiveYieldBps`
     * reflects gross − protocolFee − swap − gas − slippage (pre-risk).
     */
    normalize(opp) {
        const protocolFeeBps = this.protocolFeeBps[opp.protocol] ?? 0;
        const gross = opp.apyBps;
        const net = gross - protocolFeeBps - this.swapCostBps - this.gasCostBps - this.slippageBps;
        return {
            asset: opp.asset,
            protocol: opp.protocol,
            risk: opp.risk,
            tvlUsd: opp.tvlUsd,
            grossYieldBps: gross,
            protocolFeeBps,
            swapCostBps: this.swapCostBps,
            gasCostBps: this.gasCostBps,
            slippageBps: this.slippageBps,
        };
    }
    normalizeAll(opportunities) {
        return opportunities.map((o) => this.normalize(o));
    }
}
