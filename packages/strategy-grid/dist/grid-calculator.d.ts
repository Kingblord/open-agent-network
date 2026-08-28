/**
 * M12 — GridCalculator.
 *
 * Deterministic integer math for grid-level generation and crossing
 * detection. No floating-point arithmetic for core grid decisions.
 *
 * Levels are computed as equal-sized price intervals (in integer cents)
 * between lowerPriceCents and upperPriceCents. Crossing detection uses
 * strict integer comparison.
 *
 * BOUNDARY: The AI receives deterministic, precomputed grid levels and
 * crossings — it NEVER generates price levels, spacing, or order sizes.
 */
export declare class GridCalculator {
    /**
     * Generate deterministic grid levels from a GridConfig.
     * Returns an array of GridLevel[] with BUY/SELL assignment.
     *
     * Convention:
     *   level 0 = lowest price → BUY
     *   level (gridCount-1) = highest price → SELL
     *   Intermediate levels = BUY for lower half, SELL for upper half
     *   If gridCount is odd, the middle level is both BUY and SELL.
     *
     * All prices in integer cents. Spacing = (upper - lower) / (gridCount - 1).
     */
    generateLevels(lowerPriceCents: number, upperPriceCents: number, gridCount: number, capitalCents: number, maxOrderSizeCents: number): import('./types.js').GridLevel[];
    /**
     * Deterministic crossing detection — returns a GridCrossing if price
     * moved across a grid level, or null.
     *
     * Rules:
     *   price moves UP through a level → SELL candidate.
     *   price moves DOWN through a level → BUY candidate.
     *   Only the nearest crossed level (if any) is returned — no chain-crossing.
     */
    detectCrossing(levels: import('./types.js').GridLevel[], previousPriceCents: number, currentPriceCents: number): import('./types.js').GridCrossing | null;
    /**
     * Compute the maximum allowable order size for a crossing, given
     * current grid state and config. Returns integer cents.
     */
    computeOrderSizeCents(crossing: import('./types.js').GridCrossing, activeExposureCents: number, config: import('./types.js').GridConfig): number;
    /**
     * Estimate profit for a crossing (integer cents).
     * UP crossing → profit = 0.1% of order size (placeholder).
     * DOWN crossing → profit = 0 (no profit until the corresponding SELL fills).
     */
    estimateProfitCents(crossing: import('./types.js').GridCrossing, orderSizeCents: number, _levels: import('./types.js').GridLevel[]): number;
    /**
     * Check whether stop conditions are met.
     */
    shouldStop(priceCents: number, config: import('./types.js').GridConfig): boolean;
}
//# sourceMappingURL=grid-calculator.d.ts.map