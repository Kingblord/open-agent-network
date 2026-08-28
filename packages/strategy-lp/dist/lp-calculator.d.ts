/**
 * M11 — LpRangeCalculator.
 *
 * Deterministic tick/price/liquidity math for Uniswap V3-style concentrated
 * liquidity pools. ALL operations are integer (BigInt, integer math), no
 * floating-point arithmetic for core financial decisions.
 *
 * Covers:
 *   - sqrtPriceX96 ↔ tick boundary
 *   - tick ↔ sqrtPriceX96
 *   - Is a tick in range (lower ≤ tick < upper)
 *   - Tick alignment with tickSpacing
 *   - Position profitability metrics
 *
 * No external AMM SDK dependency — plain integer math.
 */
export declare class LpRangeCalculator {
    /**
     * Convert sqrtPriceX96 (decimal integer string) to its approximate tick.
     *
     * sqrtPriceX96 / 2^96 = sqrt(1.0001)^tick
     * tick = 2 * log(sqrtPriceX96 / 2^96) / log(1.0001)
     */
    sqrtPriceX96ToTick(sqrtPriceX96: string): number;
    /**
     * Convert tick to approximate sqrtPriceX96 (decimal bigint string).
     *
     * sqrtPrice ≈ Q96 * (1.0001 ^ (tick/2))
     */
    tickToSqrtPriceX96(tick: number): string;
    /** Is the current tick inside the position's range (lower ≤ tick < upper)? */
    isInRange(currentTick: number, lowerTick: number, upperTick: number): boolean;
    /** Round tick down to nearest valid tickSpacing boundary. */
    alignTickDown(tick: number, tickSpacing: number): number;
    /** Round tick up to nearest valid tickSpacing boundary. */
    alignTickUp(tick: number, tickSpacing: number): number;
    /**
     * Generate candidate range around the current tick, aligned to tickSpacing.
     *
     * Produces bounded deterministic ranges (never more than `maxCandidates`):
     *   - current tick ± (1 * tickSpacing → width / 2)
     *   - full range
     * This is a pure calculation — the AI never picks raw ticks.
     */
    generateCandidateRanges(currentTick: number, tickSpacing: number, maxCandidates?: number): Array<{
        lowerTick: number;
        upperTick: number;
        label: string;
    }>;
    /**
     * Estimate net profit from moving a position (or creating one) relative to
     * the candidate range.
     *
     * netProfitCents = feesEarnedCents (projected) - gasCostCents - slippageCostCents - riskAdjustmentCents
     *
     * Positive net profit means a rebalance is economically viable.
     */
    estimateNetProfitCents(projectedFeesCents: string, gasCostCents: string, slippageCents: string, riskAdjustmentCents: string): string;
    /**
     * Check if a position needs rebalancing (out of range + profitable).
     *
     * Returns true ONLY if:
     *   1. current tick is outside the position's range, AND
     *   2. estimated net profit for the best candidate is positive
     */
    shouldRebalance(currentTick: number, lowerTick: number, upperTick: number, netProfitCents: string): boolean;
    /** Token ratio: proportion of position value in token0 vs token1 at the current tick.
     *  Returns a 0–10000 basis point fraction of the position in token0. */
    token0FractionBps(currentTick: number, lowerTick: number, upperTick: number): number;
}
//# sourceMappingURL=lp-calculator.d.ts.map