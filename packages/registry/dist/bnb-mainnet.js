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
import { DeploymentRegistry } from './deployment-registry.js';
import { ProtocolRegistry } from './protocol-registry.js';
import { TokenRegistry } from './token-registry.js';
/** BAN execution chain (BNB Smart Chain mainnet). */
export const BNB_CHAIN_ID = 56;
/**
 * Verified BNB mainnet tokens (Binance-Peg). `enabled` is FALSE for all of
 * them (mustflow §12 verified ≠ executable). Recognized for selection only.
 */
export const BNB_MAINNET_TOKENS = [
    {
        id: 'wbnb',
        chainId: 56,
        address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        symbol: 'WBNB',
        name: 'Wrapped BNB',
        decimals: 18,
        verified: true,
        enabled: false,
        native: true,
    },
    {
        id: 'usdt',
        chainId: 56,
        address: '0x55d398326f99059fF775485246999027B3197955',
        symbol: 'USDT',
        name: 'Binance-Peg BSC-USD',
        decimals: 18,
        verified: true,
        enabled: false,
    },
    {
        id: 'usdc',
        chainId: 56,
        address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        symbol: 'USDC',
        name: 'Binance-Peg USD Coin',
        decimals: 18,
        verified: true,
        enabled: false,
    },
];
/** ACTIVE protocols for BAN selection (mustflow §13). */
export const BNB_MAINNET_PROTOCOLS = [
    { id: 'pancakeswap', chainId: 56, name: 'PancakeSwap', status: 'ACTIVE', official: true },
    { id: 'venus', chainId: 56, name: 'Venus', status: 'ACTIVE', official: true },
];
/**
 * Registered deployment addresses (protocol role → address).
 * `verified: false` — recognized for selection, NEVER executable until
 * verified (mustflow §10). Addresses are well-known BSC mainnet deployments.
 */
export const BNB_MAINNET_DEPLOYMENTS = [
    {
        protocolId: 'pancakeswap',
        chainId: 56,
        contracts: {
            v3SwapRouter: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
        },
        verified: false,
    },
    {
        protocolId: 'venus',
        chainId: 56,
        contracts: {
            comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
        },
        verified: false,
    },
];
/** Instantiate the three registries for the BAN execution chain. */
export function createBnbRegistries(chainId = BNB_CHAIN_ID) {
    return {
        tokens: new TokenRegistry({ chainId, tokens: BNB_MAINNET_TOKENS }),
        protocols: new ProtocolRegistry({ chainId, protocols: BNB_MAINNET_PROTOCOLS }),
        deployments: new DeploymentRegistry({ chainId, deployments: BNB_MAINNET_DEPLOYMENTS }),
    };
}
