import type { NormalizedOpportunity, YieldOpportunity } from './types.js';

/**
 * Deterministic per-component cost model. Each opportunity may carry
 * protocol-specific fees; tooling costs (swap/gas/slippage) are stable scalars.
 * All values are integer bps. No floating-point arithmetic after the APY→bps
 * boundary in YieldDataProvider.
 */
export interface YieldNormalizerConfig {
  /** protocol -> protocol fee in bps. Protocols not listed default to 0. */
  protocolFeeBps?: Record<string, number>;
  swapCostBps?: number;
  gasCostBps?: number;
  slippageBps?: number;
}

export class YieldNormalizer {
  private readonly protocolFeeBps: Record<string, number>;
  private readonly swapCostBps: number;
  private readonly gasCostBps: number;
  private readonly slippageBps: number;

  constructor(cfg: YieldNormalizerConfig = {}) {
    this.protocolFeeBps = cfg.protocolFeeBps ?? {};
    this.swapCostBps = cfg.swapCostBps ?? 25;
    this.gasCostBps = cfg.gasCostBps ?? 5;
    this.slippageBps = cfg.slippageBps ?? 30;
  }

  /**
   * Normalize a single raw opportunity into its component cost. Risk
   * adjustment is applied separately by YieldRiskModel; `effectiveYieldBps`
   * reflects gross − protocolFee − swap − gas − slippage (pre-risk).
   */
  normalize(opp: YieldOpportunity): Omit<NormalizedOpportunity, 'riskAdjustmentBps' | 'effectiveYieldBps'> {
    const protocolFeeBps = this.protocolFeeBps[opp.protocol] ?? 0;
    const gross = opp.apyBps;
    const net = gross - protocolFeeBps - this.swapCostBps - this.gasCostBps - this.slippageBps;
    return {
      asset: opp.asset,
      protocol: opp.protocol,
      risk: opp.risk,
      tvlUsd: opp.tvlUsd,
      grossYieldBps: gross,
      protocolFeeBps,
      swapCostBps: this.swapCostBps,
      gasCostBps: this.gasCostBps,
      slippageBps: this.slippageBps,
    };
  }

  normalizeAll(opportunities: YieldOpportunity[]): Omit<NormalizedOpportunity, 'riskAdjustmentBps' | 'effectiveYieldBps'>[] {
    return opportunities.map((o) => this.normalize(o));
  }
}