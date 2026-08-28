/**
 * M9 — YieldCandidateSelector.
 *
 * Deterministic filtering → ranking → bounded top-N. The AI receives ONLY the
 * output of this selector (never raw market data). Tie-breaking is fully
 * ordered: higher effective yield, then higher TVL, then protocol/asset
 * alphabetically — so the result is reproducible across runs.
 */
export class YieldCandidateSelector {
    topN;
    minEffectiveYieldBps;
    constructor(topN = 3, minEffectiveYieldBps = 0) {
        this.topN = topN;
        this.minEffectiveYieldBps = minEffectiveYieldBps;
    }
    select(all) {
        const valid = all.filter((c) => c.effectiveYieldBps > this.minEffectiveYieldBps);
        const sorted = [...valid].sort((a, b) => {
            return (b.effectiveYieldBps - a.effectiveYieldBps || // yield desc
                Number(b.tvlUsd) - Number(a.tvlUsd) || // tvl desc
                a.protocol.localeCompare(b.protocol) || // protocol asc
                a.asset.localeCompare(b.asset) // asset asc
            );
        });
        return sorted.slice(0, this.topN).map((c, i) => ({ ...c, rank: i + 1 }));
    }
}
