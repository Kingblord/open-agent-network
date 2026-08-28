import { BANError, ErrorCode } from '@ban/shared';
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
export class HealthFactorCalculator {
    /** One basis-point scale (per 10000). */
    static BPS = 10000n;
    /**
     * Compute the integer health factor (in cents).
     *
     *   HF_cents = (collateral * thresholdBps * 100) / (debt * 10000)
     */
    healthFactorCents(collateralCentsUsd, debtCentsUsd, liquidationThresholdBps) {
        const collateral = BigInt(collateralCentsUsd || '0');
        const debt = BigInt(debtCentsUsd || '0');
        const threshold = BigInt(liquidationThresholdBps);
        if (debt === 0n) {
            // No debt → infinite health; cap at the top of the scale.
            return 100_000;
        }
        if (collateral <= 0n) {
            throw new BANError(ErrorCode.POLICY_DENIED, 'Cannot compute health factor with zero collateral.', {
                retryable: false,
            });
        }
        // integer division truncates toward zero (safe/conservative).
        return Number((collateral * threshold * 100n) / (debt * HealthFactorCalculator.BPS));
    }
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
    repayNeededCents(collateralCentsUsd, debtCentsUsd, liquidationThresholdBps, targetHealthCents) {
        if (targetHealthCents <= 0)
            return '0';
        const collateral = BigInt(collateralCentsUsd || '0');
        const debt = BigInt(debtCentsUsd || '0');
        const threshold = BigInt(liquidationThresholdBps);
        const targetCents = BigInt(targetHealthCents);
        // maxDebt we can still hold while keeping the health factor >= targetCents.
        const maxDebt = (collateral * threshold * 100n) / (targetCents * HealthFactorCalculator.BPS);
        if (maxDebt >= debt)
            return '0';
        const needed = debt - maxDebt;
        // BigInt division truncated maxDebt conservatively (the safe direction).
        return needed.toString();
    }
}
