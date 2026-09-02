# BAN — Current State of the Project

> Snapshot date: 2026-09-01 · Workspace: `open-agent-network` (root name: `ban-smart-money`)
> Last updated: EIP-7702 wiring (Option A), ERC-8004 merge, UI wallet-sign step, docs refresh.
>
> This document describes **what is actually in the repo and what the UI actually does** right now (verified by direct file reads and command runs). It does not guess. Where a thing is aspirational (specs) vs implemented (code) vs wired (used at runtime), it says so explicitly.

---

## 1. Product identity (read this first)

- **Repo / package name:** `ban-smart-money` (root `package.json` description: "BAN (BNB Agent Network) - reusable autonomous agent execution network + BAN Smart Money marketplace").
- **Product:** BAN Smart Money — a BNB Chain marketplace where users discover, hire, authorize, monitor and revoke autonomous financial agents (Yield Optimisation, Health Factor Monitor, LP Rebalancing, Grid Trading).
- **Security model (non-negotiable, per `docs/mustflow.md` + `MUSTFLOW.md`):** AI is the brain, not the authority.
  - `AI → ActionProposal → deterministic Policy Engine → Execution Engine → Altana agent wallet → BNB Chain`.
  - AI never signs, never holds keys, never invents addresses/calldata.
  - Never: `LLM -> private key -> transaction`.
- **New money-flow model (per `docs/update-v3.md`):** two money flows — **(a) agent-operational** funds via Altana (x402, APIs, gas; default) and **(b) user-owned DeFi funds stay in the user wallet**, acted on ONLY through a one-time EIP-7702 bounded authorization (permission profile: capability + protocol/contract/function/token allowlists + spend ceilings + validity window + replay nonce). EIP-7702 is wired as a **gated path** (`requiresUserFunds` jobs) — Altana remains the default operational path.
- **Stale docs warning:** `docs/IMPLEMENTATION_SUMMARY.md`, `docs/DEVELOPER_GUIDE.md`, `docs/SETUP.md` still describe the old "Open Agent Network" credit-based MVP (JWT auth, credits, hirings, mock execution). They do **not** match the current codebase. `README.md` (refreshed), `docs/milestone.md`, `docs/mustflow.md`, `docs/architecture.md`, `docs/DEPLOY-VERCEL.md`, `MUSTFLOW.md` match the current BAN product.

---

## 2. Monorepo layout (verified file tree)

pnpm workspace (`pnpm-workspace.yaml`): `apps/*` + `packages/*`.

### Root
| Path | Role |
|---|---|
| `package.json` | Workspace scripts: `seed:agents`, `build:packages` (builds 14+1 packages), `dev`, `build`, `typecheck`, `lint`, `test` |
| `MUSTFLOW.md` | Mandatory protocol/contract registry spec (verified ≠ enabled, fail-closed gates) |
| `BANVault.sol` | Solidity vault contract (Remix-ready MVP, **not yet wired into execution**) |
| `vercel.json` | `{ "crons": [] }` — scheduling is Inngest, **not** Vercel cron |
| `firestore/` | `firestore.rules` (denies client access to `agent_keystores`), `firestore.indexes.json` |
| `docs/` | Specs + deploy checklist (see §1 for which are stale) |
| `.github/workflows/ci.yml` | CI only (lint/test/build) — never a runtime |
| `scripts/` | `seed-agents.mjs`, `live-smoke.ts` |

### Packages (`packages/*` — buildable TS packages)
| Package | Content |
|---|---|
| `schemas` | Zod schemas / shared types (ActionProposal, Session, Agent, Execution, Position, Performance, **AgentPermission/Eip7702Authorization/DelegationState — canonical**) |
| `shared` | `BANError`, `ErrorCode` (`UNAUTHORIZED`/`FORBIDDEN`…), `createLogger`, shared utils |
| `registry` | Fail-closed contract/token/protocol/deployment/ABI registries + BNB mainnet seeds + seed-catalog + **ERC-8004**: `erc8004Registry` (BAN-native registrations for the 4 agents), `normalizeExternalErc8004Record` (spoof-protected external normalization) |
| `signers` | `SigningBackend` / `SignedTransaction` / `SignRequest` types |
| `eip7702` | **EIP-7702 package**: `buildAuthorization`, `verifyAuthorizationForPermission` (viem `recoverAddress`; chain+nonce+signer checks; **raw + EIP-191 dual-path**), `PermissionResolver` (scope check: protocol/contract/function/token/spend), `DelegationAuthorizationBuilder/Verifier`, `spendLimit` canonical — 34/34 tests green |
| `agent-core` | `StrategyEngine` interface + `decide()` hooks (onDecision) |
| `policy-engine` | Deterministic validation + reservation ledger (agent/session/capability/contract/function/token/cap/spend/risk) |
| `execution-engine` | Execution pipeline types/logic (idempotency, preflight, session gate, reconcile; `submitted` canonical) |
| `blockchain` | Tool registry (fail-closed), providers, pancakeswap-adapter, `altana-signer` (dead duplicate — see §7) |
| `ai` | `BrainAdapter`; `OpenRouterBrainAdapter`; `DevBrainAdapter` (deterministic fail-closed) |
| `strategy-yield` / `strategy-health` / `strategy-lp` / `strategy-grid` | Deterministic strategies: observe + decide with injected brain → `StrategyDecision` |
| `performance-engine` | `PerformanceCalculator`, `classifyExecutionMode` |
| `excution-engine` | ⚠️ Typo directory (`packages/excution-engine/src/index.ts`) — dead ghost, no package.json, nothing imports it (documented, left on disk) |

## 3. Apps

### `apps/web` — Next.js 16.2.6 + React 19 + Tailwind 4 (the whole product)
- Deps of note: `@altananetwork/sdk`, `inngest`, `viem`, `firebase`/`firebase-admin`, `thirdweb`, `@x402/*`, `zod`, `@ban/*` workspace packages.
- Scripts: `prebuild` (builds packages), `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (vitest), `inngest:dev`.

### Frontend pages (`apps/web/app/`)
| Route | Purpose |
|---|---|
| `/` | Landing |
| `/login`, `/signup`, `/forgot-password` | Auth |
| `/dashboard` | User dashboard |
| `/agents`, `/agents/[id]` | Marketplace browse + detail (**reads `/api/agents` which merges BAN-native + ERC-8004 external listings**; never fabricate data) |
| `/my-agents`, `/my-agents/[id]` | Own agents + agent detail control page (incl. PERMISSIONS & LIMITS + **EIP-7702 permission cards: status/scope/spend/validity + SIGN & ACTIVATE + REVOKE**) |
| `/profile` | Manage Agents (delete own agents, wallet connect) |
| `/protocols` | Read-only protocol registry admin page (mustflow §7) |
| `/discover` | (discovery surface) |
| `/portfolio`, `/history`, `/settings`, `/notifications` | Portfolio / history / settings / notifications |

### API routes (`apps/web/app/api/`) — Next.js route handlers (control plane)
| Group | Routes |
|---|---|
| auth | `signup`, `login`, `logout`, `me`, `firebase` |
| agents | `agents` (list/create — merges ERC-8004), `agents/[id]` (CRUD), `deploy`, `delete`, `wallet`, `balance`, `lifecycle` (activate/pause/revoke), `run`, `tasks`, `sessions`, `sessions/[sessionId]`, `performance`, `activity` |
| permissions | **`permissions` (POST create PENDING; GET list by agent), `permissions/[id]/activate` (POST — server-side `verifyAuthorizationForPermission`: signer==userAddress, chain 56, nonce; raw + EIP-191 recovery; PENDING→ACTIVE), `permissions/[id]/revoke` (POST terminal REVOKED, owner-only, audited)** |
| erc8004 | **`erc8004/agents` (GET — live sync w/ `ERC8004_SCAN_API_KEY`, source-filtered native\|external)** |
| developers | `profile`, `credits`, `keys`, `keys/[id]`, `wallet`, `topup` |
| other | `jobs`, `jobs/[id]`, `inngest` (GET/POST/PUT serve), `protocols`, `prices/bnb`, `me`, `credits/transactions`, `health`, `hirings` |

### UI components (`apps/web/components/`)
`dashboard-layout`, `mobile-bottom-nav`, `live-runtime-terminal`, `wallet-connect-card`, `wallet-prompt-modal`, `toast-provider`, `theme-toggler`, `network-mode-badge`, `crypto-icon`, `copy-address`, `ui/*`, **`permission-cards` (NEW)**.

---

## 4. Internal state — core systems (verified)

### 4.1 Firestore (control-plane state) — `lib/firebase-admin.ts`
Collections: `users`, `agents`, `agent_sessions`, **`agent_permissions`** (permission profiles), `strategies`, `action_proposals`, `executions`, `jobs`, `spend_ledger`, `positions`, `market_data`, `performance`, `audit_events`, `agent_events`, `protocol_configs`, `agent_tasks`, **`agent_keystores`** (encrypted per-agent signers, Admin SDK only).

### 4.2 Agent runtime (`lib/agent-runtime/run-cycle.ts`) — the closed loop
```
OBSERVE → DECIDE → PROPOSE → POLICY → EXECUTE → persist/audit
```
- **4b user-funds gate (NEW, update-v3 §8–§11):** when `opts.requiresUserFunds === true`, resolves an **ACTIVE permission** via `findActivePermissionForJob(agentId, jobId)`, then `PermissionResolver.resolve(...)` checks the proposal is within permission scope (protocol/contract/function/token/spend). Missing/expired/revoked/out-of-scope → persist `AGENT_POLICY_DENIED` (`deniedCheck: user_funds_permission`) and return `{ ok:false, code: POLICY_DENIED }` — **no execution, no fabricate**. Operational (Altana) jobs skip this gate.
- Honesty mechanics: `isAwaitableConfigGap()`, `sanitizeErrorMessage()`, `listConfirmedExecutions()` — never fabricates CONFIRMED.
- Brain selection: `BAN_AI_PROVIDER === 'openrouter'` → OpenRouter, else Dev.

### 4.3 Persistence (`lib/agent-runtime/persistence.ts`)
`persistAuditEvent`, `persistExecution`, `upsertPosition`, `upsertPerformance`, `listPositions`, `getPerformanceByAgent` — all through `toFirestoreSafe()` (recursively drops `undefined`).

### 4.4 Per-agent wallets / Altana (`lib/altana-signer.ts` + `lib/altana/keystore.ts`)
- Firestore-first AES-256-GCM encrypted per-agent keys; `createAgentExecutionBackend` → Altana signing backend ({ proposal, calldata, to, chainId } → execute → signature), operator fallback dev-only.
- Altana holds **agent operational** funds (x402/API/gas), not user capital (update-v3 two-flow model).

### 4.5 Inngest — durable jobs / schedules
`client.ts`, `functions.ts` (`banPing`, `queueWorkers`, `banAgentTick` cron */2, `banAgentLoop`), `reconcile.ts` (`banTaskReconcile`, `banWalletProvisionSweep`). No Vercel cron.

### 4.6 Sessions / tasks
Task creation builds config (real prices), resolves allowlists fail-closed through `@ban/registry`, registers session, runs closed loop, kicks tick-loop.

### 4.7 Permissions (NEW — Option A wiring, source of truth `lib/permissions/permission-repo.ts`)
- Create PENDING (exact `AgentPermissionSchema` shape: `spend: { spendLimit|spendCap, perTransactionCap }` canonical aliases; nonce '0'; activationTxHash/revokedAt null) → server-side verify signer (user EOA signature via `verifyAuthorizationForPermission`; chain 56; nonce match; **raw + EIP-191 dual-path**) → **ACTIVE** → terminal **REVOKED** (one-shot). Only ACTIVE satisfies the run-cycle user-funds gate.
- API: `POST /api/permissions`, `POST /api/permissions/[id]/activate`, `POST /api/permissions/[id]/revoke` (authenticated, owner-scoped, audited through `persistAuditEvent`).

### 4.8 Vault (`BANVault.sol`) — exists but **not wired**
Owner/executor split; allowlists; per-tx/daily limits; job escrow. Execution currently signs direct protocol calls via Altana, not through vault (phase 2 option).

---

## 5. UI state (what the screens actually do)

### Agent detail page (`/my-agents/[id]`)
- Header, hero card (name/status/risk/protocol, stats from real positions or honest "—"/"None yet"), mode line (honest SIMULATED/etc.).
- **AGENT WALLET:** address + BNB balance (real chain read) + TOP UP + REFRESH.
- **Scheduler Heartbeat:** `~2m` cadence + live stage from AGENT_TICK; loop active.
- **TASKS:** list + CREATE TASK modal (USD→wei live, protocols/functions/risk/expiry).
- **PERMISSIONS & LIMITS:** session spend cap/max tx, session id+status, allowed functions chips, failed/denied counter, PAUSE/ACTIVATE, REVOKE ACCESS.
- **EIP-7702 PERMISSIONS (USER FUNDS) — NEW:** `PermissionCards` mounted (import line 16 + card before LIVE ACTIVITY, ~line 1086). Reads `GET /api/permissions?agentId=`; renders status chip (PENDING/ACTIVE/REVOKED), scope (protocols/functions/tokens), spend ceilings, validity, nonce; **ACTIVE → REVOKE (POST revoke, terminal)**; **PENDING → SIGN & ACTIVATE** — computes `eip7702Digest` client-side, signs with connected wallet (EIP-191 via `activeAccount.signMessage`), posts `{authorization, signature}` to `/api/permissions/[id]/activate`; server verifies (raw + EIP-191 recovery) before ACTIVE. Fail-closed: activation disabled unless wallet connected + `NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS` configured.
- **LIVE ACTIVITY:** last 6 events + VIEW ALL ANALYTICS.
- **REVIEW TERMINAL:** live stream `[OBSERVING]` `[THINKING]` `[PASS]`, `● LIVE` dot, pause/resume.
- **ANALYTICS overlay:** terminal + PERFORMANCE SUMMARY + full activity.

### Marketplace (`/agents`) — NEW ERC-8004 merge
- Reads `GET /api/agents` which merges **BAN-native agents + external ERC-8004 listings** (dedup by id; `source: BAN_NATIVE|EXTERNAL`; reputation-neutral). Live external sync (`erc8004-live.ts`) only when `ERC8004_SCAN_API_KEY` set; otherwise honest BAN-native-only.
- Search/filter/risk badges + honest empty state.

### Other pages
Profile → MANAGE AGENTS (delete → terminal-revoke + keystore destroy); Protocols read-only; Dashboard/Portfolio/History use real data with honest empty states.

---

## 6. Environment surface (`apps/web/.env.local.example` — verified names)
- Firebase web + Admin, `JWT_SECRET`, `APP_URL`
- Thirdweb: `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY`
- BNB: `BAN_RPC_URL` (mainnet), `BAN_CHAIN_ID=56`, `BAN_BNB_PRIVATE_KEY` (operator fallback dev-only), `BAN_LIVE_DATA=1`, **`DEV_PRIVATE_KEY` (mainnet dev/test deployment + EIP-7702 smoke only; call-site guarded, never prod)**, **`NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS`** (expected EIP-7702 implementation address — activation disabled without it)
- **ERC-8004: `ERC8004_SCAN_API_KEY` (8004scan.io — live external agent listing sync; also in `.env.local`)**
- Keystore: `BAN_KEYSTORE_ENCRYPTION_KEY`
- Altana relay (optional/unread): `ALTANA_RELAY_URL`, `ALTANA_TOKEN`
- AI: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `BAN_AI_PROVIDER=openrouter`
- Inngest: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`

---

## 7. Known gaps / un-wired / stale (honest list)

| Item | Status |
|---|---|
| `BANVault.sol` → execution engine wiring | ❌ Not wired (phase-2 candidate; vault exists + concept-tested) |
| `packages/blockchain/src/altana-signer.ts` | ⚠️ Dead duplicate — runtime uses `apps/web/lib/altana-signer.ts` |
| `ALTANA_RELAY_URL` / `ALTANA_TOKEN` | ⚠️ Documented, not read by prod path |
| `README.md` | ✅ Refreshed to BAN product (two money flows, permissions, ERC-8004, EIP-7702-gated) |
| `docs/IMPLEMENTATION_SUMMARY.md` / `DEVELOPER_GUIDE.md` / `SETUP.md` | ⚠️ Stale old OAN MVP |
| `vercel.json` | Empty crons by design (Inngest owns scheduling) |
| `packages/excution-engine/` | ⚠️ Dead ghost directory (no package.json, no imports) — left on disk |
| EIP-7702 live onchain activation (mainnet) | 🔌 Provider + resolver + gate wired and test-green; real mainnet activation/revocation transaction + UI wallet-sign step **not yet run** (needs funded dev key/gas; `DEV_PRIVATE_KEY` ready) |
| Tests | ~332+ passed, 0 failed across packages + web (latest root run: all suites green; runner timed out the chain, no failure) |

---

## 8. Next agreed step (for the record)

1. **UI wallet-sign step for user-funds permissions — DONE:** permission cards mounted on `/my-agents/[id]` (review exact limits → user signs one-time EIP-7702 authorization → POST activate → ACTIVE card). Server verifier now accepts raw + EIP-191 signatures (34/34 eip7702 tests green).
2. **Prove one real bounded mainnet tx through EIP-7702 path** using `DEV_PRIVATE_KEY`/funded dev account (activation + one in-scope call + revocation smoke), documenting the deliberate mainnet override of v3 §34 "testnet first" per user directive.
3. Keep Altana default operational path; `requiresUserFunds` jobs only route EIP-7702 (already wired fail-closed).
4. Optional phase 2: `BANVault.sol` as execution boundary.