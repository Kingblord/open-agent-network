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
/** Provenance sources used to seed this catalog (documented in VERIFY-SOURCES.md). */
export const BNB_SEED_PROVENANCE = {
    tokens: ['trustwallet-assets:blockchains/smartchain/tokenlist.json', 'coingecko:binance-smart-chain', '1inch:tokens/network/56'],
    protocols: ['pancakeswap-deployments', 'venus-deployments', 'aave-v3-deployments-output/bnb', 'lista-dao-docs', 'thena-deployments', 'wombat-deployments', 'aspan-deployments', 'stargate-deployments', 'defillama:protocols'],
    deployments: ['pancakeswap-v3-deployments-json', 'pancakeswap-smart-router-sdk', 'venus-bsc-comptroller', 'aave-v3-deployments-output/bnb', 'lista-dao-deployments-json', 'thena-deployments-json', 'wombat-deployments-json', 'aspan-deployments-json', 'bscscan-contract-verification'],
};
/**
 * The default mapping catalog. Mirrors the live seed truth in bnb-mainnet.ts
 * (tokens verified:true/enabled:false; deployments verified:true where the
 * 2026-08-28 pipeline confirmed code on BSC mainnet — display and selection
 * only, never executable until ContractRegistry is deliberately opened).
 */
export const BNB_SEED_CATALOG = {
    chainId: 56,
    asOfBlock: 44_000_000, // informational; verifier re-checks
    generatedAt: new Date().toISOString(),
    provenanceVersion: '1.1.0', // promotion run 2026-08-28: verified:P0 set + aave pool
    tokens: [
        {
            id: 'bnb',
            chainId: 56,
            address: '0x0000000000000000000000000000000000000000',
            symbol: 'BNB',
            name: 'BNB (native)',
            decimals: 18,
            verified: true,
            enabled: false,
            native: true,
            source: [...BNB_SEED_PROVENANCE.tokens],
        },
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
            source: [...BNB_SEED_PROVENANCE.tokens],
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
            source: [...BNB_SEED_PROVENANCE.tokens],
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
            source: [...BNB_SEED_PROVENANCE.tokens],
        },
    ],
    protocols: [
        { id: 'pancakeswap', chainId: 56, name: 'PancakeSwap', status: 'ACTIVE', official: true, priority: 'P0', source: [...BNB_SEED_PROVENANCE.protocols] },
        { id: 'venus', chainId: 56, name: 'Venus', status: 'ACTIVE', official: true, priority: 'P0', source: [...BNB_SEED_PROVENANCE.protocols] },
        { id: 'aave', chainId: 56, name: 'Aave V3', status: 'ACTIVE', official: true, priority: 'P1', source: [...BNB_SEED_PROVENANCE.protocols] },
        { id: 'lista', chainId: 56, name: 'Lista DAO', status: 'ACTIVE', official: true, priority: 'P1', source: [...BNB_SEED_PROVENANCE.protocols] },
        { id: 'thena', chainId: 56, name: 'THENA', status: 'ACTIVE', official: true, priority: 'P1', source: [...BNB_SEED_PROVENANCE.protocols] },
        { id: 'wombat', chainId: 56, name: 'Wombat', status: 'ACTIVE', official: true, priority: 'P2', source: [...BNB_SEED_PROVENANCE.protocols] },
        { id: 'aspan', chainId: 56, name: 'Aspan', status: 'ACTIVE', official: true, priority: 'P2', source: [...BNB_SEED_PROVENANCE.protocols] },
        { id: 'stargate', chainId: 56, name: 'Stargate', status: 'DISCOVERY_ONLY', official: false, priority: 'P3', source: [...BNB_SEED_PROVENANCE.protocols] },
    ],
    deployments: [
        {
            protocolId: 'pancakeswap',
            chainId: 56,
            contracts: {
                v3SwapRouter: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
                router: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
            },
            verified: true, // code confirmed on BSC mainnet (getCode) 2026-08-28.
            deployedAtBlock: 29_337_000,
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
        {
            protocolId: 'venus',
            chainId: 56,
            contracts: {
                comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
                oracle: '0xd8B6dA2bfEC71D684D3E2a2FC9492dDad5C3787F',
                vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
                vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
                vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
                vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
                vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
            },
            verified: true, // comptroller/oracle/vBNB/vUSDT/vUSDC/vETH/vBTC confirmed on-chain 2026-08-28. vBUSD removed (no bytecode — market retired).
            deployedAtBlock: 7_088_000,
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
        {
            protocolId: 'aave',
            chainId: 56,
            contracts: {
                v3Pool: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
            },
            verified: true, // code confirmed on BSC mainnet (getCode) 2026-08-28.
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
        {
            protocolId: 'lista',
            chainId: 56,
            contracts: {}, // Lista DAO role addresses pending on-chain verification (never guessed).
            verified: false,
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
        {
            protocolId: 'thena',
            chainId: 56,
            contracts: {}, // THENA deployment JSON pending verification.
            verified: false,
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
        {
            protocolId: 'wombat',
            chainId: 56,
            contracts: {}, // Wombat deployment JSON pending verification.
            verified: false,
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
        {
            protocolId: 'aspan',
            chainId: 56,
            contracts: {}, // Aspan deployment JSON pending verification.
            verified: false,
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
        {
            protocolId: 'stargate',
            chainId: 56,
            contracts: {}, // Stargate — DISCOVERY_ONLY; nothing executable.
            verified: false,
            source: [...BNB_SEED_PROVENANCE.deployments],
        },
    ],
};
