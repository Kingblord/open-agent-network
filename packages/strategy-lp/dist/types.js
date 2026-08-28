/**
 * M11 — LP Rebalancing strategy shared types.
 *
 * All pricing/amount math runs on INTEGER decimal strings / fixed integers
 * (Tick, sqrtPriceX96, liquidity, wei amounts, integer basis points) so the
 * deterministic tick boundaries and profitability math never depend on
 * floating-point arithmetic. Liquidty amounts and pool quantities are surfaced
 * by the blockchain LiquidityAdapter.
 */
export {};
