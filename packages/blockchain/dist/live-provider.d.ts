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
 * Defaults (important): when constructed WITHOUT injected deps (as the app
 * runtime does via `LiveDataProvider.instance()`), the provider boots with the
 * BAN SEED registries (`createBnbRegistries(56)` + `BNB_MAINNET_CONTRACTS`) —
 * so live reads resolve against the real, verified BSC set (PancakeSwap +
 * Venus + core tokens) by default. Unit tests inject empty/partial registries
 * and get exactly the same fail-closed behavior for anything unregistered.
 *
 * Adapters: Venus (yield+lending), PancakeSwap V3 (liquidity+swap), Aave V3
 * (lending — getUserAccountData), Lista DAO (lending — getAccountState). The
 * Aave/Lista branches are FULLY fail-closed: they resolve their contract via
 * DeploymentRegistry (requireDeploy) and only execute real reads once the
 * deployment is registered+verified. Until then they throw an explicit
 * PROVIDER_UNAVAILABLE — they NEVER return a plausible-looking fabricated
 * number.
 *
 * Price feed (CoinGecko): BNB/WBNB (+ USDT/USDC). Per-token cache; unknown
 * tokens fail closed with PROVIDER_UNAVAILABLE (never a fabricated rate).
 *
 * Where a real read is not yet provisioned (e.g. a Venus vToken deployment
 * role that isn't registered), the adapter throws an explicit
 * PROVIDER_UNAVAILABLE — it NEVER returns a fabricated number.
 */
import { ContractRegistry, TokenRegistry, DeploymentRegistry } from '@ban/registry';
import type { PriceDataAdapter, YieldAdapter, LendingAdapter, LiquidityAdapter, SwapAdapter } from './index.js';
import type { ToolAdapters } from './tools.js';
import { type PublicClient } from 'viem';
/**
 * Optional injected registry/deps (unit tests). When omitted the provider
 * boots with the BAN seed registries (P0 verified set) so the app runtime's
 * `LiveDataProvider.instance()` is functional out of the box.
 */
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
    /**
     * Registered Venus Core Pool vTokens derived from the DeploymentRegistry
     * (roles `vToken.<Underlying>` / `v<Underlying>`). Fail-closed: an absent or
     * never-verified venus deployment yields an empty list. These are READ-ONLY
     * receipt tokens — the address is the same verified one the ContractRegistry
     * enabled; this helper only derives the read surface (never authority).
     */
    private venusVTokens;
    /** Real Venus pool APYs (supply APY annualized from supplyRatePerBlock). */
    private readVenusPools;
}
//# sourceMappingURL=live-provider.d.ts.map