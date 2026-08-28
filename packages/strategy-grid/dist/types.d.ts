/**
 * M12 — Grid Trading Agent shared types.
 *
 * Core grid state, configuration, and crossing data — all using integer
 * cents/basis-point math where applicable (no arbitrary floating point).
 * Grid levels and price observations are in integer cents (USD cents).
 *
 * The AI receives ONLY bounded, precomputed crossing candidates — never
 * raw market data it could misuse to generate arbitrary levels or amounts.
 */
/** Immutable grid configuration (set at hire/activation time). */
export interface GridConfig {
    /** Lower price bound in integer cents (e.g. 25000 = $250.00). */
    lowerPriceCents: number;
    /** Upper price bound in integer cents. */
    upperPriceCents: number;
    /** Number of grid levels (≥ 2). Determines per-level spacing. */
    gridCount: number;
    /** Total capital allocated to this grid, in integer cents. */
    capitalCents: number;
    /** Max capital per order in integer cents. */
    maxOrderSizeCents: number;
    /** Maximum active exposure (sum of filled buys not yet sold) in integer cents. */
    maxActiveExposureCents: number;
    /** True → price moves below lower bound trigger stop. False → no stop. */
    stopOnLowerBoundBreak?: boolean;
    /** True → price moves above upper bound trigger stop. False → no stop. */
    stopOnUpperBoundBreak?: boolean;
    /** Session expiry (ISO timestamp). */
    expiresAt: string;
}
/** A single grid level (deterministically computed). */
export interface GridLevel {
    /** Level index (0 = lowest, gridCount-1 = highest). */
    index: number;
    /** Price at this level, in integer cents. */
    priceCents: number;
    /** Side: BUY at lower levels, SELL at upper levels (or both). */
    side: 'BUY' | 'SELL';
}
/** Price crossing event. */
export interface GridCrossing {
    /** The level that was crossed. */
    level: GridLevel;
    /** Previous price in integer cents. */
    previousPriceCents: number;
    /** Current price in integer cents. */
    currentPriceCents: number;
    /** Direction of crossing. */
    direction: 'UP' | 'DOWN';
    /** Is this crossing still actionable (not yet filled / expired)? */
    actionable: boolean;
}
/** Fill status for a single grid level. */
export interface GridFill {
    levelIndex: number;
    side: 'BUY' | 'SELL';
    filledAt: string;
    priceCents: number;
    sizeCents: number;
    txHash?: string;
}
/** In-memory grid state (tracked deterministically; will be persisted in M18). */
export interface GridState {
    config: GridConfig;
    levels: GridLevel[];
    fills: GridFill[];
    /** Running total of capital committed to buy fills in integer cents. */
    activeExposureCents: number;
    /** Total PnL from completed buy↔sell cycles in integer cents. */
    realizedPnlCents: number;
    /** True when stop conditions have been triggered. */
    stopped: boolean;
    /** Timestamp of last price observation. */
    lastPriceCents: number;
}
/** Deterministic grid candidate surfaced to the AI (bounded set). */
export type GridAction = 'BUY' | 'SELL' | 'STOP';
export interface GridCandidate {
    action: GridAction;
    level: GridLevel;
    /** Maximum order size for this crossing (constrained by config/state). */
    maxSizeCents: number;
    /** Estimated profit from executing this crossing (integer cents). */
    estimatedProfitCents: number;
    /** Gas cost estimate in integer cents. */
    estimatedGasCents: number;
    /** Net benefit (profit − gas − risk adjustment) in integer cents. */
    netBenefitCents: number;
    /** Reason for generating this candidate. */
    reason: string;
    /** Risk assessment for this candidate. */
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    /** Ranking (1 = highest priority). */
    rank: number;
}
//# sourceMappingURL=types.d.ts.map