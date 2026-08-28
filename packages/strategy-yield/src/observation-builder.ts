import type { Agent, Observation } from '@ban/schemas';
import type { YieldCandidate } from './types.js';

/**
 * M9 — ObservationBuilder.
 *
 * Produces schema-valid, structured `Observation` objects containing ONLY
 * deterministic candidate facts — NOT raw market data and NOT execution
 * parameters the AI could abuse. The observation carries enough component
 * detail for the AI to explain which opportunity it prefers and why the
 * alternatives were worse (per-candidate cost breakdown).
 */
export class ObservationBuilder {
  constructor(
    private readonly network: string,
    private readonly strategyId: string,
  ) {}

  build(agent: Agent, candidates: YieldCandidate[], constraints: { topN: number }): Observation {
    // Rejected/enriched facts live here; deliberately no raw adapter payload.
    const detailed = candidates.map((c) => ({
      asset: c.asset,
      protocol: c.protocol,
      rank: c.rank,
      risk: c.risk,
      effectiveYieldBps: c.effectiveYieldBps,
      grossYieldBps: c.grossYieldBps,
      protocolFeeBps: c.protocolFeeBps,
      swapCostBps: c.swapCostBps,
      gasCostBps: c.gasCostBps,
      slippageBps: c.slippageBps,
      riskAdjustmentBps: c.riskAdjustmentBps,
      tvlUsd: c.tvlUsd,
    }));

    return {
      id: `obs_yield_${agent.id}_${Date.now()}`,
      agentId: agent.id,
      type: 'yield_opportunities',
      observedAt: new Date().toISOString(),
      data: {
        network: this.network,
        strategyId: this.strategyId,
        topN: constraints.topN,
        candidates: detailed,
        basis: 'Integer bps; effective = gross − fees − swap − gas − slippage − risk adj.',
      },
    };
  }
}