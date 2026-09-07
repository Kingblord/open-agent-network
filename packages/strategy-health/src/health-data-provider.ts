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
export class HealthDataProvider {
  constructor(
    private readonly lending: LendingAdapter,
    private readonly price: PriceDataAdapter,
    private readonly calculator: HealthFactorCalculator = new HealthFactorCalculator(),
    private readonly riskModel: HealthRiskModel = new HealthRiskModel(),
  ) {}

  async fetch(address: string, protocol: string, collateralAssets: string[], debtAssets: string[]): Promise<HealthSnapshot> {
    const raw = await this.lending.getLendingPosition(address, protocol);
    // Collateral/debt are integer cents as decimal strings (adapter contract).
    const collateralCents = BigInt(raw.collateral || '0');
    const debtCents = BigInt(raw.borrowed || '0');
    const liquidationThresholdBps = Math.round(raw.liquidationThreshold * 10000); // 0.80 → 8000

    const healthFactorCents = this.calculator.healthFactorCents(
      collateralCents.toString(),
      debtCents.toString(),
      liquidationThresholdBps,
    );
    const riskState = this.riskModel.stateFor(healthFactorCents);

    // Context-only prices (integer cents) for observability.
    const prices: Record<string, string> = {};
    for (const asset of new Set([...collateralAssets, ...debtAssets])) {
      const p = await this.price.getTokenPrice(asset);
      prices[asset] = usdToCents(p.priceUsd);
    }

    return {
      address,
      protocol,
      collateralCentsUsd: collateralCents.toString(),
      debtCentsUsd: debtCents.toString(),
      debtByToken: raw.borrowedByToken,
      ltvBps: Math.round(raw.ltv * 10000),
      liquidationThresholdBps,
      healthFactorCents,
      riskState,
      currentLtvBps: Math.round(raw.ltv * 10000),
      liquidationThresholdAppliedBps: liquidationThresholdBps,
      timestamp: new Date().toISOString(),
      // context prices are surfaced in the observation, not required for HF math.
    };
  }
}

/** "12.34" → "1234" (integer cents). Deterministic. */
function usdToCents(usd: string): string {
  const cleaned = usd.replace(/[$,\s]/g, '');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0';
  return String(Math.round(num * 100));
}