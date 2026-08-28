/**
 * M10 — HealthFactorCalculator.
 *
 * Deterministic health-factor math over INTEGER values only.
 *
 *   healthFactor = (collateral * liquidationThreshold) / borrowed
 *
 * `collateral` and `borrowed` are supplied in the SAME integer-unit base
 * (integer cents USD). The liquidation threshold is an integer basis-point
 * value (0.80 → 8000). The result is returned as integer healthFactorCents
 * (HF × 100).
 *
 * Because the threshold is in basis points (per 10000), the correct equation
 * is:
 *
 *   HF               = collateral * (thresholdBps / 10000) / debt
 *   HF_cents = HF*100 = collateral * thresholdBps * 100 / (debt * 10000)
 *
 * Rounds DOWN on the final division by integer truncation (safe/conservative).
 */
export declare class HealthFactorCalculator {
    /** One basis-point scale (per 10000). */
    private static readonly BPS;
    /**
     * Compute the integer health factor (in cents).
     *
     *   HF_cents = (collateral * thresholdBps * 100) / (debt * 10000)
     */
    healthFactorCents(collateralCentsUsd: string, debtCentsUsd: string, liquidationThresholdBps: number): number;
    /**
     * Greedy corrective amount (integer cents) required to move a CRITICAL /
     * EMERGENCY position up to a TARGET health factor by repaying debt.
     *
     *   new_HF_cents = collateral * thresholdBps * 100 / ((debt - x) * 10000)
     *   => x >= debt - (collateral * thresholdBps * 100) / (targetCents * 10000)
     *
     * Returns the integer cents of debt to repay (rounded up to the next cent so
     * the resulting HF must reach the target, conservative).
     */
    repayNeededCents(collateralCentsUsd: string, debtCentsUsd: string, liquidationThresholdBps: number, targetHealthCents: number): string;
}
//# sourceMappingURL=health-factor-calculator.d.ts.map