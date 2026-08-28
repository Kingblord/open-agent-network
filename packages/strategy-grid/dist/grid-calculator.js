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
export class GridCalculator {
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
    generateLevels(lowerPriceCents, upperPriceCents, gridCount, capitalCents, maxOrderSizeCents) {
        if (gridCount < 2)
            throw new Error('gridCount must be >= 2');
        if (lowerPriceCents >= upperPriceCents)
            throw new Error('lowerPriceCents must be < upperPriceCents');
        if (capitalCents <= 0)
            throw new Error('capitalCents must be positive');
        const spacing = Math.floor((upperPriceCents - lowerPriceCents) / (gridCount - 1));
        if (spacing <= 0)
            throw new Error('spacing must be positive');
        const levels = [];
        const medianIndex = Math.floor((gridCount - 1) / 2);
        for (let i = 0; i < gridCount; i++) {
            const priceCents = lowerPriceCents + spacing * i;
            let side;
            if (i < medianIndex)
                side = 'BUY';
            else if (i > medianIndex)
                side = 'SELL';
            else
                side = 'BUY'; // median level — buy (conservative default)
            levels.push({ index: i, priceCents, side });
        }
        return levels;
    }
    /**
     * Deterministic crossing detection — returns a GridCrossing if price
     * moved across a grid level, or null.
     *
     * Rules:
     *   price moves UP through a level → SELL candidate.
     *   price moves DOWN through a level → BUY candidate.
     *   Only the nearest crossed level (if any) is returned — no chain-crossing.
     */
    detectCrossing(levels, previousPriceCents, currentPriceCents) {
        if (previousPriceCents === currentPriceCents)
            return null;
        if (currentPriceCents > previousPriceCents) {
            // Price moved up — find the highest level that was crossed
            for (let i = levels.length - 1; i >= 0; i--) {
                const level = levels[i];
                if (previousPriceCents < level.priceCents && currentPriceCents >= level.priceCents) {
                    return {
                        level,
                        previousPriceCents,
                        currentPriceCents,
                        direction: 'UP',
                        actionable: true,
                    };
                }
            }
        }
        else {
            // Price moved down — find the lowest level that was crossed
            for (let i = 0; i < levels.length; i++) {
                const level = levels[i];
                if (previousPriceCents > level.priceCents && currentPriceCents <= level.priceCents) {
                    return {
                        level,
                        previousPriceCents,
                        currentPriceCents,
                        direction: 'DOWN',
                        actionable: true,
                    };
                }
            }
        }
        return null;
    }
    /**
     * Compute the maximum allowable order size for a crossing, given
     * current grid state and config. Returns integer cents.
     */
    computeOrderSizeCents(crossing, activeExposureCents, config) {
        if (crossing.direction === 'UP') {
            // SELL — reduce exposure; limited by available filled amount
            return Math.min(activeExposureCents, config.maxOrderSizeCents);
        }
        else {
            // BUY — increase exposure; limited by remaining capital and max order
            const remainingCapital = config.capitalCents - activeExposureCents;
            return Math.max(0, Math.min(remainingCapital, config.maxOrderSizeCents));
        }
    }
    /**
     * Estimate profit for a crossing (integer cents).
     * UP crossing → profit = 0.1% of order size (placeholder).
     * DOWN crossing → profit = 0 (no profit until the corresponding SELL fills).
     */
    estimateProfitCents(crossing, orderSizeCents, _levels) {
        if (orderSizeCents <= 0)
            return 0;
        // UP crossing (≈ SELL opportunity) → small profit estimate
        if (crossing.direction === 'UP') {
            return Math.floor(orderSizeCents * 0.001);
        }
        // DOWN crossing (≈ BUY) → no profit yet
        return 0;
    }
    /**
     * Check whether stop conditions are met.
     */
    shouldStop(priceCents, config) {
        if (config.stopOnLowerBoundBreak && priceCents < config.lowerPriceCents)
            return true;
        if (config.stopOnUpperBoundBreak && priceCents > config.upperPriceCents)
            return true;
        return false;
    }
}
//# sourceMappingURL=grid-calculator.js.map