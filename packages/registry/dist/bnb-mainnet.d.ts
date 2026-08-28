/**
 * BNB mainnet (chain 56) registry seeds — mustflow §5/§10–13.
 *
 * The BAN execution chain default is BNB mainnet (56). These are the seed
 * records for the Token / Protocol / Deployment registries that the control
 * plane uses to RESOLVE user choices into registry entries:
 *
 *   - Tokens (USDT / USDC / WBNB)  → verified, NOT enabled yet. "verified ≠
 *     enabled" (mustflow §12): a user may *bound* a session to these symbols,
 *     but autonomous execution stays fail-closed (enabled=false) until the
 *     on-chain verification/activation step for each deployment.
 *   - Protocols (PancakeSwap / Venus) → ACTIVE for selection.
 *   - Deployments (PCS V3 SwapRouter / Venus Comptroller) → registered with
 *     well-known BSC mainnet addresses, verified:false (display/selection
 *     only — never executable until verified).
 *
 * Nothing here enables execution. Execution authority lives in
 * ContractRegistry (enabled + func capability) and is NOT seeded yet, so all
 * autonomous execution is DENIED by default (fail-closed).
 */
import { DeploymentRecord } from './deployment-registry.js';
import { DeploymentRegistry } from './deployment-registry.js';
import { ProtocolRecord } from './protocol-registry.js';
import { ProtocolRegistry } from './protocol-registry.js';
import { TokenRecord } from './token-registry.js';
import { TokenRegistry } from './token-registry.js';
/** BAN execution chain (BNB Smart Chain mainnet). */
export declare const BNB_CHAIN_ID = 56;
/**
 * Verified BNB mainnet tokens (Binance-Peg). `enabled` is FALSE for all of
 * them (mustflow §12 verified ≠ executable). Recognized for selection only.
 */
export declare const BNB_MAINNET_TOKENS: TokenRecord[];
/** ACTIVE protocols for BAN selection (mustflow §13). */
export declare const BNB_MAINNET_PROTOCOLS: ProtocolRecord[];
/**
 * Registered deployment addresses (protocol role → address).
 * `verified: false` — recognized for selection, NEVER executable until
 * verified (mustflow §10). Addresses are well-known BSC mainnet deployments.
 */
export declare const BNB_MAINNET_DEPLOYMENTS: DeploymentRecord[];
/** Instantiate the three registries for the BAN execution chain. */
export declare function createBnbRegistries(chainId?: number): {
    tokens: TokenRegistry;
    protocols: ProtocolRegistry;
    deployments: DeploymentRegistry;
};
//# sourceMappingURL=bnb-mainnet.d.ts.map