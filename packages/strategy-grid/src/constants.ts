/**
 * BSC mainnet constants for executable grid orders.
 *
 * Grid proposals are CANONICALIZED by the strategy (never by the LLM): the
 * brain only picks side/level; these addresses and swap parameters are the
 * deterministic execution surface. Keeping them here (rather than trusting a
 * model-authored contract address) is a real-funds safety invariant — a
 * hallucinated contract can never reach policy/execution.
 */

/** BSC mainnet chainId. */
export const BSC_MAINNET_CHAIN_ID = 56;

/** Binance-Peg BSC-USD (USDT, 18 decimals). */
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955';

/** Wrapped BNB (WBNB, 18 decimals). */
export const BSC_WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

/** PancakeSwap V3 Smart Router (BSC mainnet) — swap routing. */
export const BSC_PANCAKE_V3_SMART_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4';

/**
 * Default slippage guard for grid fills (bps, 300 = 3%). Grid levels re-price
 * continuously, so a fill is only taken within a tight band of the level price;
 * a moved market reverts the swap on-chain instead of filling at a bad price.
 */
export const GRID_SLIPPAGE_BPS_DEFAULT = 300;

/**
 * Default PancakeSwap V3 fee tier for the USDT↔WBNB route (bps ×10: 500 =
 * 0.05%). If a task needs a different pool tier it can override via
 * `feeTier` in the canonicalized params (validated to the V3 tier set).
 */
export const GRID_FEE_TIER_DEFAULT = 500;

/** PancakeSwap V3 supported fee tiers (hundredths of a bip). */
export const PANCAKE_V3_FEE_TIERS = [100, 500, 2500, 10000] as const;

/** Router function used for canonical grid swaps. */
export const GRID_SWAP_FUNCTION = 'exactInputSingle';

/** Swap execution kind marker consumed by the execution/signer layer. */
export const GRID_EXEC_KIND = 'PANCAKE_V3_SWAP' as const;
