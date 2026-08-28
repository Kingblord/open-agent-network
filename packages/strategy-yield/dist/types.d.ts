/**
 * M9 — Yield Optimisation strategy shared types.
 *
 * All monetary/economic quantities are expressed as INTEGER basis points (bps)
 * so the effective-yield calculation never depends on floating-point arithmetic.
 * The only float→int conversion happens once at the adapter boundary
 * (APY percent → bps), and every downstream subtraction is integer math.
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
/** Raw opportunity as surfaced by the underlying blockchain YieldAdapter. */
export interface YieldOpportunity {
    asset: string;
    protocol: string;
    /** Gross annualised yield, already converted to integer bps (0.01%). */
    apyBps: number;
    tvlUsd: string;
    risk: RiskLevel;
    timestamp: string;
}
/**
 * A fully-normalized opportunity with every cost component broken out so the
 * effective yield can be explained ("why this one won/lost"). `effectiveYieldBps`
 * is gross − protocolFee − swapCost − gas − slippage − riskAdjustment.
 */
export interface NormalizedOpportunity {
    asset: string;
    protocol: string;
    risk: RiskLevel;
    tvlUsd: string;
    grossYieldBps: number;
    protocolFeeBps: number;
    swapCostBps: number;
    gasCostBps: number;
    slippageBps: number;
    riskAdjustmentBps: number;
    effectiveYieldBps: number;
}
/** A ranked candidate surfaced to the AI (the bounded, decision-ready envelope). */
export interface YieldCandidate {
    asset: string;
    protocol: string;
    risk: RiskLevel;
    tvlUsd: string;
    grossYieldBps: number;
    protocolFeeBps: number;
    swapCostBps: number;
    gasCostBps: number;
    slippageBps: number;
    riskAdjustmentBps: number;
    effectiveYieldBps: number;
    rank: number;
}
//# sourceMappingURL=types.d.ts.map