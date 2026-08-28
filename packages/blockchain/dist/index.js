import { BANError, ErrorCode, createLogger } from '@ban/shared';
/**
 * viem-backed provider factory (BNB mainnet - chainId 56). This file does not
 * initialize a provider at import time — only when the execution layer calls it,
 * so dev/demo environments without RPC access remain functional.
 *
 * The factory is fail-closed: when BAN_RPC_URL / BAN_CHAIN_ID are not configured
 * (or point to a chain other than mainnet 56 when production is enforced), it
 * refuses to start rather than silently talking to the wrong network.
 */
export function requireBlockchainRuntime() {
    throw new BANError(ErrorCode.INTERNAL, 'Blockchain runtime is not configured. Set BAN_RPC_URL and BAN_CHAIN_ID to enable onchain adapters.', { retryable: false });
}
export const blockchainLogger = createLogger('blockchain');
// Re-export the deterministic, hermetic dev provider behind the SAME adapter
// seam as any future live BNB provider (M6 Rule 7). Consumers may import it so
// the tool layer + strategies run fully offline in tests/dev. It never claims
// real BNB Chain data completeness.
export { DevDataProvider } from './dev-provider.js';
export { buildToolHandles } from './tools.js';
// Re-export the REAL live BNB provider behind the same seam (Rule 7). It is
// env-gated + Gate-A chain-verified (mainnet 56 only) and fails closed — the
// tool layer + strategies consume REAL data only when BAN_LIVE_DATA=1.
export { LiveDataProvider } from './live-provider.js';
