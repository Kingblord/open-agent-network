/**
 * BAN Live BNB data provider (Milestone 6 / Rule 7 compliant).
 *
 * Implements the exact `ToolAdapters` seam (price / yield / lending /
 * liquidity / swap + chain sidecar) with REAL BNB Chain data behind viem when
 * enabled — never fabricated numbers.
 *
 * Env gate (fail-closed):
 *   - Requires BAN_RPC_URL (a real BNB mainnet endpoint).
 *   - Requires BAN_CHAIN_ID === 56 (Gate A verified via `verify()`).
 *   - Without those, constructing this provider THROWS (offline-safe). The
 *     runtime's `resolveDataProvider()` falls back to DevDataProvider only for
 *     explicit dev/test (Rule 7).
 *
 * Registry gate (fail-closed): every protocol/address this adapter touches is
 * resolved through @ban/registry (ContractRegistry / TokenRegistry /
 * DeploymentRegistry). If the required deployment isn't registered+verified,
 * the adapter throws rather than contacting a guessed address.
 *
 * Where a real read is not yet provisioned (e.g. specific Venus vToken
 * registry entries), the adapter throws an explicit PROVIDER_UNAVAILABLE —
 * it NEVER returns a plausible-looking fabricated number.
 */
import { ContractRegistry, TokenRegistry, DeploymentRegistry } from '@ban/registry';
import type { PriceDataAdapter, YieldAdapter, LendingAdapter, LiquidityAdapter, SwapAdapter } from './index.js';
import type { ToolAdapters } from './tools.js';
import { type PublicClient } from 'viem';
/** Optional injected registry/deps (unit tests); defaults to empty (fail-closed). */
export interface LiveProviderDeps {
    contracts?: ContractRegistry;
    tokens?: TokenRegistry;
    deployments?: DeploymentRegistry;
    publicClient?: PublicClient;
    priceFeed?: PriceDataAdapter;
}
/**
 * Live BNB Chain data provider. Implements the exact `ToolAdapters` shape so
 * the tool layer + strategies consume REAL data when enabled.
 */
export declare class LiveDataProvider implements ToolAdapters {
    readonly price: PriceDataAdapter;
    readonly yield: YieldAdapter;
    readonly lending: LendingAdapter;
    readonly liquidity: LiquidityAdapter;
    readonly swap: SwapAdapter;
    readonly chain: ToolAdapters['chain'];
    private readonly publicClient;
    private readonly contracts;
    private readonly tokens;
    private readonly deployments;
    private _verified;
    private static _instance?;
    /** Gate A — verify the RPC really is BNB mainnet (chainId 56) once. */
    verify(): Promise<void>;
    static instance(): LiveDataProvider;
    constructor(deps?: LiveProviderDeps);
    /** Resolve a token by symbol / address / id (may be unregistered → null). */
    private resolveToken;
    /** Fail-closed deployment lookup. */
    private requireDeploy;
    /** Optional deployment lookup (null when absent). */
    private tryDeployment;
    /** Registered vToken deployments under the venus protocol (role prefix vToken.). */
    private venusVTokens;
    /** Real Venus pool APYs (supply APY annualized from supplyRatePerBlock). */
    private readVenusPools;
}
//# sourceMappingURL=live-provider.d.ts.map