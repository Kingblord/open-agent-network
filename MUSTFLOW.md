# BAN — Protocol & Contract Registry (Mandatory System)

> mustflow §10–§14 · **verified ≠ enabled** · fail-closed by default.
>
> This document is the mandatory specification for BAN's on-chain protocol
> set. The registry is the **single source of truth** for what BAN may touch —
> and it is deliberately **small, verified, and never auto-enabled**.

## 1. Principle

BAN integrates a **small, explicitly-verified set of BSC (chain 56) protocols**
first — not hundreds of contracts. Every integration is expressed as:

```
protocol → deployment (chain-56 address) → contract → capability → ABI
```

The AI never sees raw addresses as authority. The flow is always:

```
AI ("I want to swap USDT → WBNB")
  → Tool Registry
  → Protocol Adapter
  → BAN Contract Registry
       ├─ Is protocol ACTIVE?
       ├─ Is chain 56?
       ├─ Is deployment verified?
       ├─ Is contract enabled (+ function capability)?
       ├─ Is token allowed?
  → Transaction Builder → Simulation → Policy → Execution
```

## 2. Scope — the initial verified BSC set

| Priority | Protocol | BAN use | Integration status |
|---|---|---|---|
| 🔴 P0 | **PancakeSwap** | Swap + LP + Grid | READ_ONLY → EXECUTION_ENABLED (first executable integration) |
| 🔴 P0 | **Venus** | Health Factor + Lending Yield | READ_ONLY → EXECUTION_ENABLED (first executable integration) |
| 🔴 P0 | **BNB / WBNB / USDT / USDC** | Core assets | Verified tokens, selection only |
| 🟠 P1 | Aave V3 | Lending Yield/Health | Selection only (verified:false until pipeline) |
| 🟠 P1 | Lista DAO | BNB yield | Selection only (EMPTY map until confirmed) |
| 🟠 P1 | THENA | DEX/LP alternative | Selection only (EMPTY map pending verification) |
| 🟡 P2 | Wombat | Stablecoin liquidity | Selection only (EMPTY map pending verification) |
| 🟡 P2 | Aspan | BNB yield | Selection only (EMPTY map pending verification) |
| 🟢 P3 | Stargate | Cross-chain | **DISCOVERY_ONLY** (no BAN strategy yet) |

## 3. Mandatory registry structure

`packages/registry/` contains the **only** authority source:

```
packages/registry/
├── protocols/        → protocol identity + status (ACTIVE / DISCOVERY_ONLY / …)
├── tokens/           → token identity + verified/enabled split
├── contracts/        → per-protocol contract records:
│      chainId 56 · protocolId · address · verified · enabled ·
│      capabilities (SWAP / LP / LENDING / YIELD / …) ·
│      allowedFunctions (name + capability READ_ONLY | EXECUTE) ·
│      abiVersion · source · lastVerifiedAt
├── deployments/      → protocol role → verified chain-56 address (+ deployedAtBlock)
└── abi/              → canonical ABI fragments per (contract, function)
```

Every contract record uses the shape:
```ts
{
  chainId: 56,
  protocolId: 'pancakeswap',
  contractId: 'v3-swap-router',
  address: '0x…',
  verified: true,        // on-chain existence + (optionally) source-verified
  status: 'ACTIVE',      // selection gate
  capabilities: ['SWAP'],
  allowedFunctions: [
    { name: 'exactInputSingle', capability: 'EXECUTE' },
    { name: 'quoteExactInputSingle', capability: 'READ_ONLY' },
  ],
  abiVersion: 'v3',
  source: ['pancakeswap-smart-router-sdk'],
  lastVerifiedAt: '…',
}
```

## 4. Gates (all mandatory, all fail-closed)

| Gate | Fail behavior |
|---|---|
| Protocol `status === 'ACTIVE'` (chain 56) | DENIED if inactive/DISCOVERY_ONLY/wrong-chain |
| Deployment has a **verified** address | HOLD (not verified) until pipeline confirms |
| Contract **registered** | DENIED if unknown address |
| Contract **verified** | HOLD until on-chain + source check |
| Contract **enabled** | DENIED (verified ≠ enabled) — never auto-enabled |
| Function declared with `EXECUTE` capability | DENIED if undeclared / READ_ONLY |
| Token **verified + enabled** | DENIED if unknown/unverified/not-enabled |

The integration ladder is **derived from these same booleans**:
`DISCOVERY_ONLY → READ_ONLY → SIMULATION → EXECUTION_ENABLED`.
There is no separate status flag that can diverge from the gates.

## 5. Addresses are never guessed

- No address is copied from a random website into the registry.
- Default mappings come from **official, provenance-tracked sources**:
  PancakeSwap SDK (`SMART_ROUTER_ADDRESSES[ChainId.BSC]`),
  `pancakeswap/pancake-v3-contracts` `deployments/bscMainnet.json`,
  Venus `VenusProtocol/venus-protocol` `deployments/bscmainnet`,
  Aave `@bgd-labs/aave-address-book` (typed), Lista DAO docs/JSON.
- Sources are recorded in `packages/registry/src/seed-catalog/VERIFY-SOURCES.md`.
- `verified:false` + EMPTY contract map = recognized, never executable.

## 6. Verification pipeline (mandatory before any execution enablement)

```bash
pnpm --filter @ban/registry run fetch:seeds   # resolve official JSON → candidates (read-only)
pnpm --filter @ban/registry run verify:seeds  # on-chain getCode (chain 56) + optional BscScan
```

- `verified` flips **true only when code exists on chain AND source check passes**.
- `enabled` is **never** set by the pipeline (verified ≠ executable).
- Promotion into `bnb-seeds.ts` is a **human-reviewed step**.

## 7. Admin / settings page (mandatory page flow)

A dedicated **Protocol Registry** admin page (`/protocols`, read-only) MUST show:
- the **integration ladder** legend (DISCOVERY_ONLY → … → EXECUTION_ENABLED),
- **supported tokens** (symbol, name, address, verified, enabled, native),
- each **protocol**: name, priority, status, derived integration status + why,
- each **contract**: address, capabilities, allowedFunctions + capability
  (READ_ONLY vs EXECUTE), derived status,
- the note **"verified ≠ enabled — this view grants no authority."**

This page is backed by `GET /api/protocols` (auth-gated, read-only snapshot of
the fail-closed registries). It has **no write path**.

## 8. Execution enablement (explicit, deliberate)

To move a protocol from READ_ONLY to EXECUTION_ENABLED, ALL of these must be
done **by a human**:
1. Contract **verified:true** (pipeline confirmed on-chain + source),
2. Contract **enabled:true** (explicit registry enable — never automatic),
3. At least one function declared with **EXECUTE** capability,
4. Token(s) verified + enabled,
5. The protocol's adapter implemented and test-covered.

Nothing in this repo auto-enables any of these.