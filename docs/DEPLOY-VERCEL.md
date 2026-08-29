# BAN Smart Money — Vercel Deployment Checklist

This is the **authoritative** checklist for deploying to Vercel and running a live
agent flow. Every env var name below is copied from the code that reads it
(`apps/web/lib/firebase-admin.ts`, `apps/web/.env.local.example`,
`apps/web/lib/altana-signer.ts`, `apps/web/inngest/client.ts`) — nothing is guessed.

## 0. Build fix (already in the repo)

`apps/web/package.json` now has:

```json
"prebuild": "pnpm -w build:packages"
```

`pnpm` always resolves the workspace root, so Vercel compiles all 14 `packages/*`
**before** `next build` on every deploy. This fixes the stale-`dist` failure
(`Module not found: Can't resolve 'zod'` from `packages/blockchain/dist/tools.js`).

⚠️ If Vercel is still configured with a custom Root Directory, set it to
**empty / repo root** (Build Command is then `pnpm run build`). If you keep
Root Directory = `apps/web`, Build Command should be `pnpm build` so the
root `prebuild`-equivalent still runs.

## 1. Environment Variables (Vercel → Project → Settings → Environment Variables)

Add for **Production** (and Preview if you test there).

### Required — Firebase Admin (server-only; without these, ALL DB routes 500)
| Name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | your Firebase project id |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | service-account private key. Paste **exactly** as in the JSON, or base64-encode the whole value to avoid `\n` escaping issues |

### Required — Firebase Web (public, `NEXT_PUBLIC_*`) — same values as `.env.local`
`NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
`NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`,
`NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`,
`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional).

### Required — Auth
| Name | Value |
|---|---|
| `JWT_SECRET` | `openssl rand -base64 32` output |
| `APP_URL` | your Vercel URL (e.g. `https://your-app.vercel.app`) |

### Required — Wallet / Thirdweb
| Name | Value |
|---|---|
| `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` | public client id |
| `THIRDWEB_SECRET_KEY` | server-side secret (wallet-ownership verification) |

### Required — BNB live data + execution
| Name | Value |
|---|---|
| `BAN_LIVE_DATA` | `1` (enable real BNB data; omit → hermetic dev provider) |
| `BAN_RPC_URL` | `https://bsc-dataseed1.binance.org` (or your RPC) |
| `BAN_CHAIN_ID` | `56` |
| `BAN_BNB_PRIVATE_KEY` | dev/test signer key hex (NEVER a user's key) |

### Required — Inngest cron (2-min autonomous tick)
| Name | Value |
|---|---|
| `INNGEST_EVENT_KEY` | from `app.inngest.com` → your app → Settings → Environments |
| `INNGEST_SIGNING_KEY` | same screen (validates webhooks hitting `/api/inngest`) |

Without these, the `ban-agent-tick` cron runs in dev-only mode and won't fire in
production.

### Optional
| Name | Value |
|---|---|
| `OPENROUTER_API_KEY` | real LLM reasoning (default: deterministic DevBrainAdapter) |
| `ALTANA_RELAY_URL` / `ALTANA_TOKEN` | Altana wallet-relay (if used) |

## 2. Deploy + verify

1. Push to `main` → Vercel auto-deploys (or `vercel --prod`).
2. Confirm in the Vercel build log: `prebuild` runs and all `packages/*` compile,
   then `next build` succeeds.
3. Hit `https://<app>.vercel.app/api/health` → expect `200`.
4. Inngest: check the app is registered in the Inngest dashboard (functions
   `ban-agent-tick`, `run-agent-cycle`, queue workers) and the cron shows active.

## 3. Live agent flow test (after deploy is green)

1. **Fund the agent wallet** with BNB (address shown in the app — My Agents card).
2. **Create a scoped session** (tokens: BNB/WBNB/USDT/USDC verified+enabled;
   protocols: PancakeSwap/Venus verified+enabled P0) → session becomes ACTIVE.
3. **Activate the agent** → status ACTIVE (audit written).
4. Wait ≤2 min for the Inngest cron (`ban-agent-tick`) — or hit
   `POST /api/agents/[id]/run` (owner-only) for an instant cycle.
5. Watch the Activity feed: observe (real data if `BAN_LIVE_DATA=1`) → decide →
   propose → policy → **real broadcast** (`TRANSACTION_CONFIRMED`) → position /
   performance / audit. Scheduler Heartbeat card shows `● {stage} · 2m ago`.

## 4. Honest failure modes (by design)

- No Firestore env → every API route 500s (`Firebase Admin is not configured`).
- No `INNGEST_*` keys → cron never fires; app still works with manual `/run`.
- `BAN_LIVE_DATA` unset → observations are the hermetic DevDataProvider
  (Rule 7: never claimed as real).
- Wallet not funded / session not ACTIVE → runtime stops at honest
  `awaiting execution` — no fabricated transactions.
- Unverified/UNENABLED contract in a proposal → policy DENIES (fail-closed;
  nothing unrecognized is ever executable).