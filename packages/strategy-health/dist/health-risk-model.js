import { BANError, ErrorCode } from '@ban/shared';
/**
 * M10 — HealthRiskModel (STRATEGY SIGNAL ONLY).
 *
 * Deterministically maps a health factor (integer cents) to a categorical risk
 * state, and (later) applies simple strategy-time constraints for candidate
 * selection. It does NOT authorize anything — M5 PolicyEngine remains the
 * authoritative execution authorization layer.
 *
 * FAIL-CLOSED: an unknown/negative/NaN health factor raises rather than being
 * treated as safe (EMERGENCY also fails closed at its lower bound).
 *
 * Thresholds (healthFactor cents):
 *   HEALTHY   >= 200
 *   WARNING   150 <= HF < 200
 *   CRITICAL  110 <= HF < 150
 *   EMERGENCY < 110
 */
export const HEALTH_THRESHOLDS = {
    HEALTHY_MIN: 200,
    WARNING_MIN: 150,
    CRITICAL_MIN: 110,
};
export class HealthRiskModel {
    /** Map a health factor (integer cents) to a categorical risk state. */
    stateFor(healthFactorCents) {
        if (Number.isNaN(healthFactorCents) || healthFactorCents < 0) {
            throw new BANError(ErrorCode.POLICY_DENIED, `Invalid health factor '${String(healthFactorCents)}' (fail-closed).`, { retryable: false });
        }
        if (healthFactorCents >= HEALTH_THRESHOLDS.HEALTHY_MIN)
            return 'HEALTHY';
        if (healthFactorCents >= HEALTH_THRESHOLDS.WARNING_MIN)
            return 'WARNING';
        if (healthFactorCents >= HEALTH_THRESHOLDS.CRITICAL_MIN)
            return 'CRITICAL';
        return 'EMERGENCY';
    }
    /**
     * Interpret a raw LendingAdapter snapshot (which carries a float healthFactor)
     * into the categorical risk state. Adapter float is the one conversion
     * boundary; downstream everything is integer cents.
     */
    stateFromRaw(raw) {
        const hfCents = Math.round(raw.healthFactor * 100);
        return this.stateFor(hfCents);
    }
}
