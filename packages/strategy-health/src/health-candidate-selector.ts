import { HealthFactorCalculator } from './health-factor-calculator.js';
import { HEALTH_THRESHOLDS } from './health-risk-model.js';
import type { HealthSnapshot, HealthCandidate } from './types.js';

/**
 * M10 — HealthCandidateSelector.
 *
 * Deterministic corrective-action selection for a health snapshot:
 *
 *   - HEALTHY / WARNING → no corrective action (empty set → AI should PASS).
 *   - CRITICAL → one REPAY candidate targeting a safe health factor.
 *   - EMERGENCY → one REPAY candidate (priority) + one ADD_COLLATERAL
 *     alternative, both targeting a safe health factor.
 *
 * Repay/deposit amounts are computed deterministically from the position and a
 * target health factor (integer cents). The AI receives ONLY this bounded,
 * ranked candidate set — never raw position data it could misuse.
 *
 * Strategy signal only — does NOT authorize anything. Execution is left to M5
 * PolicyEngine + M8 execution engine in the M18 live loop.
 */
const REPAY_SAFE_TARGET_CENTS = 250; // HF 2.50 primary REPAY target
const COLLATERAL_MIN_TARGET_CENTS = HEALTH_THRESHOLDS.WARNING_MIN; // HF 1.50
const BPS = 10000n;

/** The underlying with the LARGEST borrow balance — the deterministic REPAY target. */
function dominantDebtToken(debtByToken: Record<string, string> | undefined): string | undefined {
  if (!debtByToken) return undefined;
  let best: string | undefined;
  let bestWei = 0n;
  for (const [symbol, wei] of Object.entries(debtByToken)) {
    try {
      const w = BigInt(wei || '0');
      if (w > bestWei) {
        bestWei = w;
        best = symbol;
      }
    } catch { /* skip malformed */ }
  }
  return best;
}

export class HealthCandidateSelector {
  private readonly calculator: HealthFactorCalculator;

  constructor(calculator: HealthFactorCalculator = new HealthFactorCalculator()) {
    this.calculator = calculator;
  }

  select(snapshot: HealthSnapshot): HealthCandidate[] {
    const fromState = snapshot.riskState;
    if (fromState === 'HEALTHY' || fromState === 'WARNING') return [];

    const candidates: HealthCandidate[] = [];

    if (fromState === 'CRITICAL' || fromState === 'EMERGENCY') {
      const repay = this.calculator.repayNeededCents(
        snapshot.collateralCentsUsd,
        snapshot.debtCentsUsd,
        snapshot.liquidationThresholdBps,
        REPAY_SAFE_TARGET_CENTS,
      );
      if (BigInt(repay || '0') > 0n) {
        candidates.push({
          action: 'REPAY',
          protocol: snapshot.protocol,
          address: snapshot.address,
          targetState: 'HEALTHY',
          amountCentsUsd: repay,
          // Repay the LARGEST debt market — the deterministic, safest vToken
          // to pay down when the lender carries multiple borrow balances.
          denomination: dominantDebtToken(snapshot.debtByToken),
          fromState,
          rank: 1,
        });
      }
    }

    if (fromState === 'EMERGENCY') {
      candidates.push({
        action: 'ADD_COLLATERAL',
        protocol: snapshot.protocol,
        address: snapshot.address,
        targetState: 'WARNING',
        amountCentsUsd: estimatedCollateralNeeded(snapshot),
        fromState,
        rank: 2,
      });
    }

    return candidates;
  }
}

/**
 * Estimated additional collateral (integer cents) to lift an EMERGENCY
 * position to at least WARNING (HF 1.50) — conservative.
 *
 *   required total collateral to reach target HF:
 *     HF_cents = collateral * thresholdBps * 100 / (debt * 10000) >= target
 *     => collateral >= debt * target * 100 / thresholdBps
 */
function estimatedCollateralNeeded(snapshot: HealthSnapshot): string {
  const debt = BigInt(snapshot.debtCentsUsd || '0');
  const thresholdBps = BigInt(snapshot.liquidationThresholdBps || '0');
  const target = BigInt(COLLATERAL_MIN_TARGET_CENTS);
  if (debt <= 0n || thresholdBps <= 0n) return '0';
  const totalNeeded = (debt * target * 100n) / thresholdBps;
  const have = BigInt(snapshot.collateralCentsUsd || '0');
  return (totalNeeded > have ? totalNeeded - have : 0n).toString();
}