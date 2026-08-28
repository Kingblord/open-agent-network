/**
 * M10 — Health Factor Monitoring strategy shared types.
 *
 * All monetary quantities are expressed as INTEGER decimal strings (wei/sat) or
 * INTEGER basis points (bps) / scaled integers so the deterministic health
 * math never depends on floating-point arithmetic. The only float→int boundary
 * happens once at the adapter boundary (price USD → integer cents), and every
 * downstream calculation is integer math.
 */

/** Categorical lending-risk state, derived deterministically from the health factor. */
export type HealthRiskState = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';

/** Raw lending position as surfaced by the blockchain LendingAdapter. */
export interface HealthLendingSnapshot {
  address: string;
  protocol: string;
  collateral: string; // wei decimal string
  borrowed: string; // wei decimal string
  ltv: number; // 0..1 decimal
  liquidationThreshold: number; // 0..1 decimal
  healthFactor: number; // float, converted to integer cents by the calculator
  assetPrices: Record<string, string>; // symbol -> USD price in integer cents
  timestamp: string;
}

/**
 * A fully-processed snapshot with every component broken out so the health
 * state and any proposed corrective action are explainable. Health factor is
 * stored as integer "cents" (HF × 100) to avoid float drift.
 */
export interface HealthSnapshot {
  address: string;
  protocol: string;
  collateralCentsUsd: string; // integer cents of collateral USD value
  debtCentsUsd: string; // integer cents of borrowed USD value
  ltvBps: number; // integer basis points (0..10000)
  liquidationThresholdBps: number; // integer basis points
  /** Health factor as integer cents (e.g. 250 = 2.50). */
  healthFactorCents: number;
  riskState: HealthRiskState;
  currentLtvBps: number;
  liquidationThresholdAppliedBps: number;
  timestamp: string;
}

/** A deterministic corrective-action candidate surfaced to the AI (bounded set). */
export interface HealthCandidate {
  action: 'REPAY' | 'ADD_COLLATERAL' | 'NONE';
  protocol: string;
  address: string;
  /** Residual risk state if this candidate's target were achieved. */
  targetState: HealthRiskState;
  /** Integer cents needed to reach the target (REPAY) or added as collateral (ADD_COLLATERAL). */
  amountCentsUsd: string;
  /** Which risk state this candidate is meant to escape. */
  fromState: HealthRiskState;
  rank: number;
}

/** Risk state alias kept consistent with the canonical vocabulary. */
export type RiskState = HealthRiskState;