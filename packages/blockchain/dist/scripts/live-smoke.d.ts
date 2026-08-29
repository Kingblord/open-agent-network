/**
 * BAN live data smoke probe — read-only, real BNB mainnet.
 *
 * Builds the LiveDataProvider (seed registries included), Gate-A verifies the
 * RPC, then probes REAL data: prices (BNB/USDT/USDC), gas, a native balance,
 * Venus yield pools, a Venus lending position, and a PancakeSwap quote.
 *
 * Every probe is printed with its real value or an honest failure — nothing
 * is fabricated, nothing exits non-zero on a failed probe (partial results
 * are still informative). The only hard failure is missing BAN_RPC_URL or a
 * Gate-A verification mismatch (wrong chain), which the provider itself
 * throws.
 *
 * Usage:
 *   pnpm --filter @ban/blockchain run smoke:live [address]
 *
 *   BAN_RPC_URL must point at BNB mainnet (56). Optional address argument
 *   defaults to the PancakeSwap V3 Smart Router (holds real balances).
 */
export {};
//# sourceMappingURL=live-smoke.d.ts.map