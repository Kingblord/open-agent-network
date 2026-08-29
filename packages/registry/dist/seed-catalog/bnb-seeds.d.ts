/**
 * BNB mainnet (chain 56) default-mapping catalog — mustflow §10–§14.
 *
 * This is the single provenance-tracked source that the @ban/registry seeds
 * are derived from. It is NOT an execution allowlist:
 *
 *   - `verified` = the entry is RECOGNIZED as a real on-chain deployment/asset
 *     (candidate for selection). verified ≠ executable (mustflow §12).
 *   - `enabled`  = allowed for AUTONOMOUS execution. Nothing here is enabled;
 *     execution authority lives in ContractRegistry and is NOT seeded, so all
 *     autonomous execution stays DENIED by default (fail-closed).
 *
 * Scope — the SMALL, verified BSC protocol set BAN starts with (hackathon):
 *   - Tokens: native BNB + Binance-Peg WBNB / USDT / USDC (core assets).
 *   - Protocols: P0 PancakeSwap + Venus (first executable-path integrations);
 *     P1 Aave V3 + Lista DAO + THENA; P2 Wombat + Aspan; P3 Stargate
 *     (DISCOVERY_ONLY). priority is roadmap info only, never authority.
 *   - Deployments: PancakeSwap V3 SmartRouter (sourced from the official SDK
 *     constant) + Venus Core Pool (Comptroller/Oracle/vTokens); Aave V3 Pool
 *     from the typed address-book; Lista/THENA/Wombat/Aspan EMPTY — must be
 *     confirmed by the verification pipeline from published deployment JSON /
 *     docs — we never guess addresses into the catalog.
 *
 * Provenance:
 *   - Tokens: Binance-Peg canonical addresses (TrustWallet
 *     blockchains/smartchain/tokenlist.json), cross-checked CoinGecko + 1inch.
 *   - Deployments: PancakeSwap SDK SMART_ROUTER_ADDRESSES[BSC],
 *     `pancakeswap/pancake-v3-contracts` deployments/bscMainnet.json; Venus
 *     Core Pool JSON (`VenusProtocol/venus-protocol` deployments/bscmainnet);
 *     Aave V3 (`aave-address-book` typed package); Lista DAO docs/JSON.
 *   - asOfBlock is informational; the verifier re-checks at runtime.
 *
 * Promotion record (2026-08-28 — `pnpm --filter @ban/registry run verify:seeds`):
 *   - vBUSD (venus, 0x95c78222B3D6e262dCeD22886E1D4A6f52e70008) returned
 *     codeLen=0 in two independent getCode checks (BSC mainnet; vUSDC read
 *     9490 bytes on the same query) — Venus retired the BUSD market, the
 *     address is stale. NOT promoted; REMOVED from the seed map so it is
 *     never offered as a selectable market. Re-added only via the pipeline.
 */
export interface SeedTokenEntry {
    id: string;
    chainId: number;
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    verified: boolean;
    enabled: boolean;
    native?: boolean;
    /** Where this candidate came from (provenance token). */
    source: string[];
}
export interface SeedProtocolEntry {
    id: string;
    chainId: number;
    name: string;
    status: 'ACTIVE' | 'DISCOVERY_ONLY' | 'PENDING' | 'DISABLED';
    official: boolean;
    priority?: 'P0' | 'P1' | 'P2' | 'P3';
    source: string[];
}
export interface SeedDeploymentEntry {
    protocolId: string;
    chainId: number;
    /** role -> candidate address (well-known BSC mainnet). */
    contracts: Record<string, string>;
    verified: boolean;
    /** Flips to true only when the verification pipeline confirms on-chain. */
    deployedAtBlock?: number;
    source: string[];
}
export interface BnbSeedCatalog {
    chainId: number;
    asOfBlock?: number;
    generatedAt: string;
    provenanceVersion: string;
    tokens: SeedTokenEntry[];
    protocols: SeedProtocolEntry[];
    deployments: SeedDeploymentEntry[];
}
/** Provenance sources used to seed this catalog (documented in VERIFY-SOURCES.md). */
export declare const BNB_SEED_PROVENANCE: {
    readonly tokens: readonly ["trustwallet-assets:blockchains/smartchain/tokenlist.json", "coingecko:binance-smart-chain", "1inch:tokens/network/56"];
    readonly protocols: readonly ["pancakeswap-deployments", "venus-deployments", "aave-v3-deployments-output/bnb", "lista-dao-docs", "thena-deployments", "wombat-deployments", "aspan-deployments", "stargate-deployments", "defillama:protocols"];
    readonly deployments: readonly ["pancakeswap-v3-deployments-json", "pancakeswap-smart-router-sdk", "venus-bsc-comptroller", "aave-v3-deployments-output/bnb", "lista-dao-deployments-json", "thena-deployments-json", "wombat-deployments-json", "aspan-deployments-json", "bscscan-contract-verification"];
};
/**
 * The default mapping catalog. Mirrors the live seed truth in bnb-mainnet.ts
 * (tokens verified:true/enabled:false; deployments verified:true where the
 * 2026-08-28 pipeline confirmed code on BSC mainnet — display and selection
 * only, never executable until ContractRegistry is deliberately opened).
 */
export declare const BNB_SEED_CATALOG: BnbSeedCatalog;
//# sourceMappingURL=bnb-seeds.d.ts.map