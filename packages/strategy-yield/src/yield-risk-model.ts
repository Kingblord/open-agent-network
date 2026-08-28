import { BANError, ErrorCode } from '@ban/shared';
import type { NormalizedOpportunity, RiskLevel } from './types.js';

/**
 * M9 — YieldRiskModel (STRATEGY SIGNAL ONLY).
 *
 * Produces a per-risk-tier adjustment for candidate ranking and enforces risk
 * compatibility between the agent's declared risk profile and the opportunity.
 * It does NOT authorize anything — M5 PolicyEngine remains the authoritative
 * execution authorization layer.
 *
 * FAIL-CLOSED: an opportunity carrying an unknown/missing risk level throws
 * rather than silently downgrading to LOW.
 */
const RISK_ADJUSTMENT_BPS: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 50, HIGH: 100 };

const COMPATIBLE: Record<RiskLevel, readonly RiskLevel[]> = {
  LOW: ['LOW'],
  MEDIUM: ['LOW', 'MEDIUM'],
  HIGH: ['LOW', 'MEDIUM', 'HIGH'],
};

export class YieldRiskModel {
  /** Integer bps deducted for a given opportunity risk tier. */
  adjustmentBps(risk: RiskLevel): number {
    const adj = RISK_ADJUSTMENT_BPS[risk];
    if (adj === undefined) {
      throw new BANError(ErrorCode.POLICY_DENIED, `Unknown risk tier '${String(risk)}' (fail-closed).`, {
        retryable: false,
      });
    }
    return adj;
  }

  private compatible(agentRisk: RiskLevel, oppRisk: RiskLevel): boolean {
    return COMPATIBLE[agentRisk]?.includes(oppRisk) ?? false;
  }

  /**
   * Apply per-tier risk adjustments and compatibility filtering.
   * - throws on unknown/missing opportunity risk (fail-closed)
   * - drops (does not rank) opportunities whose risk tier exceeds the agent profile
   * - sets `effectiveYieldBps = gross − fee − swap − gas − slippage − adjustment`
   */
  apply(normalized: Omit<NormalizedOpportunity, 'riskAdjustmentBps' | 'effectiveYieldBps'>[], agentRisk: RiskLevel): NormalizedOpportunity[] {
    const out: NormalizedOpportunity[] = [];
    for (const n of normalized) {
      const adjustment = RISK_ADJUSTMENT_BPS[n.risk];
      if (adjustment === undefined) {
        throw new BANError(
          ErrorCode.POLICY_DENIED,
          `Unknown risk '${String(n.risk)}' cannot be ranked (fail-closed).`,
          { retryable: false },
        );
      }
      if (!this.compatible(agentRisk, n.risk)) continue; // drop incompatible (not an error)
      out.push({
        ...n,
        riskAdjustmentBps: adjustment,
        effectiveYieldBps: n.grossYieldBps - n.protocolFeeBps - n.swapCostBps - n.gasCostBps - n.slippageBps - adjustment,
      });
    }
    return out;
  }
}