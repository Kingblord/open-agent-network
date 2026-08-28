import type { PriceDataAdapter, LendingAdapter } from '@ban/blockchain';
import type { HealthSnapshot } from './types.js';
import { HealthFactorCalculator } from './health-factor-calculator.js';
import { HealthRiskModel } from './health-risk-model.js';
/**
 * M10 — HealthDataProvider.
 *
 * Thin, deterministic boundary adapter over the LendingAdapter/PriceDataAdapter
 * seams (never raw RPC). It assembles a fully-processed `HealthSnapshot` whose
 * quantities are integer cents / integer basis points so all downstream math is
 * deterministic integer arithmetic.
 *
 * Contract for the underlying adapter:
 *   - `getLendingPosition` returns `collateral` and `borrowed` as INTEGER cents
 *     of USD (decimal strings), `ltv`/`liquidationThreshold` as 0..1 floats
 *     (the one float→int conversion boundary), and `healthFactor` (ignored here
 *     — we recompute it deterministically from collateral/borrowed/threshold).
 *   - `getTokenPrice` returns USD dollars as a decimal string (converted to
 *     integer cents here for any context values we carry).
 */
export declare class HealthDataProvider {
    private readonly lending;
    private readonly price;
    private readonly calculator;
    private readonly riskModel;
    constructor(lending: LendingAdapter, price: PriceDataAdapter, calculator?: HealthFactorCalculator, riskModel?: HealthRiskModel);
    fetch(address: string, protocol: string, collateralAssets: string[], debtAssets: string[]): Promise<HealthSnapshot>;
}
//# sourceMappingURL=health-data-provider.d.ts.map