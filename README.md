# BAN Smart Money (formerly Open Agent Network)

**BAN (BNB Agent Network)** — reusable autonomous agent execution network + BAN Smart Money marketplace.

A marketplace where developers hire autonomous financial agents that operate under provable, bounded authority on BNB Smart Chain. Agents observe real on-chain/market data, reason through a deterministic policy engine (never the AI blindly), reserve spend before executing, and settle through an auditable execution engine — all behind a Firestore control plane and Inngest durable scheduling.

> **Note:** this README reflects the current architecture. Earlier "Open Agent Network (OAN)" credit-MVP docs describe the legacy product and are being retired.

---

## Two money flows (the core model)

| Flow | Funds live in | Mechanism | Status |
|---|---|---|---|
| **Agent operational** (x402 services, external APIs, gas) | **Altana agent wallet** (per-agent keystore) | Altana scoped sessions + policy engine + SpendLedger | ✅ **Default today** |
| **User DeFi funds** (positions, deposits, repayments) | **User's wallet** | **EIP-7702** one-time bounded authorization (future, isolated) | 🔒 Behind `AuthorizationProvider` seam; not enabled |

Altana is the agent's *operational* wallet only — it never owns user capital.

---

## Architecture

- **Frontend**: Next.js 16 + React 19, Tailwind CSS, shadcn/ui.
- **Control plane**: Next.js API routes + **Firestore** (agents, jobs, sessions, permissions, spend ledger, executions, audit).
- **Scheduler**: **Inngest** durable execution (event loop, cron, reconcile). **No Vercel cron.**
- **Packages** (pnpm workspace `packages/*`):
  - `@ban/schemas` — shared Zod domain schemas (agents, jobs, sessions, permissions, proposals, spend, executions, EIP-7702).
  - `@ban/registry` — fail-closed token/protocol/contract/ABI registries (+ ERC-8004 agent listings).
  - `@ban/signers` — deterministic signing primitives / policy-bound signer.
  - `@ban/eip7702` — EIP-7702 authorization, verification, permission binding, delegation (isolated, future).
  - `@ban/agent-core` — agent interfaces (brain, policy, execution, session, capability).
  - `@ban/policy-engine` — deterministic policy gate (capability/session/contract/function/token/cap/spend/risk) + atomic SpendLedger reserve.
  - `@ban/execution-engine` — idempotent execution (proposal → preflight → submit → reconcile → confirm).
  - `@ban/blockchain` — viem providers, tool registry, Altana signer, PancakeSwap/Venus adapters.
  - `@ban/ai` — reasoning layer ONLY (Dev / OpenRouter), never signs or executes.
  - `@ban/strategy-*` — Yield, Health, LP Rebalancing, Grid Trading.
  - `@ban/performance-engine` — performance tracking.
  - `@ban/shared` — errors, logging, conventions.

## Security invariants (non-negotiable)

- **AI is brain-only**: reasoning → proposals; never holds keys, never signs.
- **Policy engine is deterministic**: fail-closed on capability, session, contract, function, token, cap, cumulative spend, risk.
- **SpendLedger**: atomic reserve-before-execute; nothing broadcasts without a reservation.
- **Execution engine**: only policy-approved proposals cross the boundary; idempotent, never blind-resubmits.
- **Registry fail-closed**: unknown tokens/protocols/contracts/selectors are DENIED.
- **Network**: BSC mainnet (56) by default; testnet (97) only via explicit config; never silently submit mainnet tx.
- **No fabricated data**: no fake APY/allocations/portfolio/confidence/performance; honest empty states.

## Setup

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local   # then fill values
pnpm dev
```

Key env vars (see `apps/web/.env.local.example`):

- `NEXT_PUBLIC_FIREBASE_*` — Firebase client config
- Firestore admin creds (service account)
- `JWT_SECRET`
- `BAN_RPC_URL`, `BAN_CHAIN_ID=56` — BNB mainnet
- `BAN_BNB_PRIVATE_KEY` — dev/test signer (never a user's/AI's key)
- `DEV_PRIVATE_KEY` — **mainnet dev/test key** (EIP-7702 activation/revocation tests only)
- `BAN_INNGEST_*` / `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — Inngest cloud
- `BAN_AI_PROVIDER`, `OPENROUTER_API_KEY` — AI reasoning provider

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Run `apps/web` dev server |
| `pnpm build:packages` | Build all `packages/*` |
| `pnpm build` | Build packages + web |
| `pnpm typecheck` | Build packages + typecheck web |
| `pnpm test` | Build packages + run all package + web tests |

## Marketplace

- `/agents` — browse agents (BAN-native registry + **ERC-8004 listings**), search/filter/risk.
- `/agents/[id]` — agent detail (identity, strategy, capabilities, risk, protocols, permission requirements).
- `/my-agents` — manage/hire your agents; startup wallet funding, heartbeat, permissions, tasks, live activity, review terminal.

## Docs

- `docs/milestone.md` — original milestone spec
- `docs/update.md` / `docs/update-v3.md` — v2/v3 architecture updates (two money flows, EIP-7702 rationale)
- `docs/mustflow.md`, `MUSTFLOW.md` — must-flow requirements
- `CURRENT_STATE.md` — detailed project state snapshot
- `BANVault.sol` — optional escrow vault (unwired by default)

## Status

- ✅ Marketplace + registry + ERC-8004 listings
- ✅ Policy engine + SpendLedger + execution engine (mainnet-scoped)
- ✅ Altana operational wallet path (per-agent keystore)
- ✅ Four agent strategies (Yield/Health/LP/Grid)
- ✅ Inngest loop + crons + reconcile (~2m cadence)
- 🔒 EIP-7702: isolated `@ban/eip7702`, schema support, `AuthorizationProvider` seam next; not enabled by default
- 🔒 BANVault optional escrow — unwired unless separately feature-flagged

---

Built with Next.js, Firestore, Inngest, viem, and ❤ — on BNB Smart Chain.