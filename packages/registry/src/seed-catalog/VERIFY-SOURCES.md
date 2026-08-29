# BNB Seed Catalog — Verification Sources

> mustflow §10–§14: recognized ≠ verified ≠ enabled. The catalog in
> `packages/registry/src/seed-catalog/bnb-seeds.ts` seeds candidates for
> **selection/display only**; the pipeline in `verify-seeds.ts` promotes
> `verified:false → true` only after on-chain confirmation. **Nothing here
> enables autonomous execution.**

## Scope — the small, verified BSC set BAN starts with (hackathon)

| Priority | Protocol | BAN use | Integration status intent |
|---|---|---|---|
| 🔴 P0 | **PancakeSwap** | Swap + LP + Grid | First executable integration (Swap/LP/grid/yield via pools + Smart Router) |
| 🔴 P0 | **Venus** | Health Factor + Lending Yield | First executable integration (Comptroller/Oracle/vTokens) |
| 🔴 P0 | **BNB / WBNB / USDT / USDC** | Core assets | Verified tokens, selection only (not yet enabled) |
| 🟠 P1 | Aave V3 | Lending Yield/Health | Selection only — verified:false until pipeline confirms on-chain |
| 🟠 P1 | Lista DAO | BNB yield | Selection only — EMPTY map until confirmed from official docs/JSON |
| 🟠 P1 | THENA | DEX/LP alternative | Selection only — EMPTY map pending verification |
| 🟡 P2 | Wombat | Stablecoin liquidity | Selection only — EMPTY map pending verification |
| 🟡 P2 | Aspan | BNB yield | Selection only — EMPTY map pending verification |
| 🟢 P3 | Stargate | Cross-chain | **DISCOVERY_ONLY** — no BAN strategy yet; never executable |

## Sources used for the default mappings

### Tokens (BEP-20)
| Source | What it provides | Status |
|---|---|---|
| TrustWallet assets — `blockchains/smartchain/tokenlist.json` | De-facto canonical BSC token list + addresses | Seed provenance (checked into `bnb-seeds.ts`) |
| CoinGecko — `https://tokens.coingecko.com/binance-smart-chain/all.json` | Full BSC token list, stable format | Cross-check |
| 1inch — `https://tokens.1inch.io/v1.2/network/56` | Chain-56 token + address list | Cross-check |
| `@uniswap/token-lists` | JSON schema + validation + resolution | Format for future external list imports |

### Deployment JSON URLs (chain 56) — used by `fetch:seeds`
The fetcher tries these in order and **fails closed** (prints `EMPTY` /
`FETCH_FAILED` with the HTTP status, writes no candidates) if a source is
unreachable or has no resolvable role. Override with `AAVE_BNB_DEPLOYMENT_URL` /
`LISTA_BNB_DEPLOYMENT_URL` / `PANCAKE_BNB_DEPLOYMENT_URL` if a path moves.

| Protocol | Repo | Path (raw) | HTTP check (this run) | Role keys recognized |
|---|---|---|---|---|
| PancakeSwap V3 | `pancakeswap/pancake-v3-contracts` | `deployments/bscMainnet.json` — `https://raw.githubusercontent.com/pancakeswap/pancake-v3-contracts/main/deployments/bscMainnet.json` | ✅ **200 confirmed** | `SwapRouter`, `MasterChefV3`, `PancakeV3Factory`, `NonfungiblePositionManager`, `QuoterV2` (keyed-object / nested `address`) |
| PancakeSwap Smart Router | `@pancakeswap/smart-router` (npm SDK) | `SMART_ROUTER_ADDRESSES[ChainId.BSC]` | ✅ **SDK constant** (installed) | `router` |
| Venus Core Pool | `VenusProtocol/venus-protocol` | `deployments/bscmainnet/addresses.json` (+ per-market vToken JSON) | ⏳ **verify path on next run** | Comptroller, Oracle, vBNB/vUSDT/vBUSD/vUSDC/vETH/vBTC |
| Aave V3 | `aave/aave-v3-deploy` | `deployments/bnb.json` — `https://raw.githubusercontent.com/aave/aave-v3-deploy/main/deployments/bnb.json` | ❌ **404** (guessed path; repo exists, exact path unresolved from this IP) | `Pool`, `PoolAddressesProvider`, `AaveOracle` |
| Aave V3 (fallbacks) | `aave/v3-deployments` | `output/bnb.json` (master/main) | ❌ 404 | same roles |
| Lista DAO | `lista-dao/lista-token` | `broadcast/ListaToken.s.sol/bscMainnet/run-latest.json` | ❌ **404** (guessed path) | Foundry broadcast `transactions[]` → `contractName`+`contractAddress` |
| Lista DAO (fallbacks) | lista-contracts / docs | `deployments/bnb.json` / docs static JSON | ❌ 404 | keyed-object roles |
| THENA / Wombat / Aspan | docs / deployment JSON | — | pending discovery | keyed-object roles |
| Stargate | cross-chain deployments | — | **DISCOVERY_ONLY** | not applicable (no BAN strategy) |

> **Aave V3 + Lista DAO (+ THENA/Wombat/Aspan)**: registered as RECOGNIZED
> protocols with EMPTY (or candidate-only) contract maps in `bnb-seeds.ts` /
> `bnb-mainnet.ts`. Their role addresses must be confirmed from the **actual
> current** published deployment JSON via the verification pipeline before any
> live use — we never guess addresses into the catalog. `verified:false +
> empty map` = fail-closed (never executable).

### Canonical on-chain sources (no JSON-path guessing)
- **PancakeSwap Smart Router SDK** — `SMART_ROUTER_ADDRESSES[ChainId.BSC]` is the
  official, maintained address constant (npm `@pancakeswap/smart-router`).
  This is the **canonical** integration path for the router (not a hardcoded
  copy from a website).
- **Aave address-book** — `@bgd-labs/aave-address-book` typed package,
  `AaveV3BNB.POOL` / `AaveV3BNB.ORACLE` — the Aave-DAO/BGD canonical source.
- **BscScan** (`api.bscscan.com`) — canonical block explorer, reachable with no
  API key for basic queries; source-verification name checks need a key.
- **Live adapters** already read **real on-chain state** via viem `getCode` /
  RPC on chain 56 — so the *verification* step does not depend on any GitHub
  JSON path.

## On-chain verification gates
| Gate | Mechanism | Fail behavior |
|---|---|---|
| Chain existence | viem `getCode` on chain 56 (bytecode length > 0) | HOLD (not verified) |
| Source verification (optional) | BscScan `getsourcecode` `ContractName`/`Proxy` match when `BSCSCAN_API_KEY` set | HOLD if source check confirms a mismatch or BscScan is configured but unreachable |

## Promotion rules (never automatic)
- `verified` flips **true only when code exists on chain AND (no BscScan key OR source verified)**.
- `enabled` is **never** set by this pipeline — verified ≠ executable (mustflow §12).
- Executing a contract requires ContractRegistry `enabled` + function capability,
  which is deliberately **not seeded** — all autonomous execution stays DENIED by
  default (fail-closed).
- Fetched candidates (Pancake / Aave V3 / Lista DAO) are written to
  `dist/seed-catalog/fetched-addresses.json` and **verified read-only**;
  promoting them into `bnb-seeds.ts` is an explicit, human-reviewed step.

## How to run
```bash
# 1) Resolve official deployment JSON → candidate addresses (read-only)
pnpm --filter @ban/registry run fetch:seeds

# 2) code-existence check on chain 56 (no API key needed)
pnpm --filter @ban/registry run verify:seeds

# 3) + BscScan source verification
BSCSCAN_API_KEY=... pnpm --filter @ban/registry run verify:seeds
```