import type { NormalizedOpportunity, YieldCandidate } from './types.js';

/**
 * M9 — YieldCandidateSelector.
 *
 * Deterministic filtering → ranking → bounded top-N. The AI receives ONLY the
 * output of this selector (never raw market data). Tie-breaking is fully
 * ordered: higher effective yield, then higher TVL, then protocol/asset
 * alphabetically — so the result is reproducible across runs.
 */
export class YieldCandidateSelector {
  constructor(
    private readonly topN: number = 3,
    private readonly minEffectiveYieldBps: number = 0,
  ) {}

  select(all: NormalizedOpportunity[]): YieldCandidate[] {
    const valid = all.filter((c) => c.effectiveYieldBps > this.minEffectiveYieldBps);
    const sorted = [...valid].sort((a, b) => {
      return (
        b.effectiveYieldBps - a.effectiveYieldBps || // yield desc
        Number(b.tvlUsd) - Number(a.tvlUsd) || // tvl desc
        a.protocol.localeCompare(b.protocol) || // protocol asc
        a.asset.localeCompare(b.asset) // asset asc
      );
    });
    return sorted.slice(0, this.topN).map((c, i) => ({ ...c, rank: i + 1 }));
  }
}