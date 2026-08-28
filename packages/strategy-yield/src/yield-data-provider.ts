import type { YieldAdapter } from '@ban/blockchain';
import type { YieldOpportunity } from './types.js';

/**
 * M9 — YieldDataProvider.
 *
 * Thin, deterministic boundary adapter: pulls raw yield opportunities from the
 * underlying blockchain adapter and converts the one float-ish quantity (APY
 * percent) into integer basis points ONCE. Everything downstream is integer math.
 *
 * It wraps the `YieldAdapter` seam (never raw RPC) so the same provider works
 * against the dev provider now and a real BNB yield source later.
 */
export class YieldDataProvider {
  constructor(private readonly adapter: YieldAdapter) {}

  async fetch(network: string): Promise<YieldOpportunity[]> {
    const raw = await this.adapter.getYieldOpportunities(network);
    return raw.map((r) => ({
      asset: r.asset,
      protocol: r.protocol,
      // The ONLY float→int boundary; rounded deterministically.
      apyBps: Math.round(r.apy * 100),
      tvlUsd: r.tvlUsd,
      risk: r.risk,
      timestamp: r.timestamp,
    }));
  }
}