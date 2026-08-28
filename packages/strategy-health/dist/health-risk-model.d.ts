import type { HealthLendingSnapshot, HealthRiskState } from './types.js';
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
export declare const HEALTH_THRESHOLDS: {
    readonly HEALTHY_MIN: 200;
    readonly WARNING_MIN: 150;
    readonly CRITICAL_MIN: 110;
};
/** Agent risk profile used to decide whether a reachable state warrants action. */
export interface HealthFilter {
    /** The worst risk state the agent tolerates being in at rest. */
    maxRiskState: HealthRiskState;
}
export declare class HealthRiskModel {
    /** Map a health factor (integer cents) to a categorical risk state. */
    stateFor(healthFactorCents: number): HealthRiskState;
    /**
     * Interpret a raw LendingAdapter snapshot (which carries a float healthFactor)
     * into the categorical risk state. Adapter float is the one conversion
     * boundary; downstream everything is integer cents.
     */
    stateFromRaw(raw: HealthLendingSnapshot): HealthRiskState;
}
//# sourceMappingURL=health-risk-model.d.ts.map