/**
 * TRACE STRATEGY — see exactly what the AI returns, live, closed loop.
 *
 * Runs ONE strategy's observe → OpenRouter decide → canonical proposal and
 * prints:
 *   1. The EXACT prompt sent to OpenRouter (system + user, truncated)
 *   2. The RAW OpenRouter response JSON (before any validation) — the key
 *      diagnostic for ERR_POLICY_DENIED
 *   3. The normalized decision (post-brain, pre-schema)
 *   4. The canonicalized proposal (strategy-authored execution fields)
 *
 * Usage:
 *   node scripts/trace-strategy.mjs grid        # grid, default bounds
 *   node scripts/trace-strategy.mjs health      # health, owner-wallet if linked
 *   node scripts/trace-strategy.mjs yield|lp
 *   node scripts/trace-strategy.mjs grid --lower 600 --upper 800 --cap 100
 *
 * Reads apps/web/.env.local for OPENROUTER_API_KEY / BAN_RPC_URL /
 * BAN_LIVE_DATA / etc. Uses the REAL OpenRouter brain and REAL BSC reads.
 */

import { config as dotenv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// ---- 1. Load env (same file the web app uses) ----
const envPath = path.resolve(process.cwd(), 'apps/web/.env.local');
if (fs.existsSync(envPath)) dotenv({ path: envPath });
else console.warn('[trace] apps/web/.env.local not found — using process env only.');

// ---- 2. Args ----
const args = process.argv.slice(2);
const strategyArg = args[0] ?? 'grid';
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : NaN;
};
const lowerUsd = Number.isFinite(flag('lower')) ? flag('lower') : 600;
const upperUsd = Number.isFinite(flag('upper')) ? flag('upper') : 800;
const capUsd = Number.isFinite(flag('cap')) ? flag('cap') : 100;
const maxOrderUsd = Number.isFinite(flag('max')) ? flag('max') : 20;
const walletArg = args.find((a) => /^0x[a-fA-F0-9]{40}$/.test(a));

function die(msg) {
  console.error(`\n[trace] ${msg}`);
  process.exit(1);
}

// ---- 3. Traced fetch: log the raw OpenRouter exchange ----
const realFetch = globalThis.fetch;
const tracedFetch = async (url, init) => {
  try {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (body) {
      console.log('\n════════ PROMPT SENT TO OPENROUTER ════════');
      console.log(`model=${body.model}`);
      console.log('── system (first 1600 chars) ──');
      const sys = body.messages?.[0]?.content;
      console.log(Array.isArray(sys) ? sys.join('\n').slice(0, 1600) : String(sys ?? '').slice(0, 1600));
      console.log('\n── user (first 1800 chars) ──');
      const usr = body.messages?.[1]?.content;
      console.log(Array.isArray(usr) ? usr.join('\n').slice(0, 1800) : String(usr ?? '').slice(0, 1800));
    }
  } catch { /* not JSON — keep going */ }

  const res = await realFetch(url, init);
  const text = await res.text();
  console.log('\n════════ RAW OPENROUTER RESPONSE (verbatim) ════════');
  console.log(text.slice(0, 4000) + (text.length > 4000 ? `\n…[truncated ${text.length} chars total]` : ''));
  return new Response(text, { status: res.status, headers: res.headers });
};

if (!process.env.OPENROUTER_API_KEY) {
  console.warn('\n[trace] OPENROUTER_API_KEY missing — brain will fail closed (still shows the fail-closed path).');
}

// ---- 4. Agent fixture (mirrors seed-agents.mjs ids) ----
const STRATEGY = strategyArg.toLowerCase();
const agent = {
  id: `agent-${STRATEGY}`,
  name: `Trace ${STRATEGY}`,
  description: 'trace run',
  type: STRATEGY,
  ownerId: 'trace-owner',
  walletAddress: walletArg ?? '0x0000000000000000000000000000000000000000',
  status: 'ACTIVE',
  capabilities:
    STRATEGY === 'grid' ? [{ id: 'PROPOSE_GRID_ORDER', name: 'Propose grid order' }]
    : STRATEGY === 'health' ? [{ id: 'PROPOSE_REPAY', name: 'Repay' }]
    : STRATEGY === 'yield' ? [{ id: 'PROPOSE_DEPOSIT', name: 'Deposit' }]
    : [{ id: 'PROPOSE_LP_REBALANCE', name: 'LP Rebalance' }],
  protocols: STRATEGY === 'lp' ? ['0xpool'] : STRATEGY === 'grid' ? ['pancakeswap'] : ['venus'],
  riskLevel: 'LOW',
  strategyId: STRATEGY,
  createdAt: new Date().toISOString(),
};

// ---- 5. Live provider + OpenRouter brain ----
const { LiveDataProvider } = await import('../packages/blockchain/dist/index.js');
const { OpenRouterBrainAdapter } = await import('../packages/ai/dist/index.js');

const live = process.env.BAN_LIVE_DATA === '1';
if (!live) console.warn('\n[trace] BAN_LIVE_DATA != 1 — using DEV provider (no real RPC). Set BAN_LIVE_DATA=1 for live reads.');
const provider = live ? LiveDataProvider.instance() : (await import('../packages/blockchain/dist/index.js')).DevDataProvider.instance();

const brain = new OpenRouterBrainAdapter({ fetch: tracedFetch });

// ---- 6. Build strategy with the same wiring as production ----
let strategy;
if (STRATEGY === 'grid') {
  const { GridDataProvider, GridStrategy } = await import('../packages/strategy-grid/dist/index.js');
  strategy = new GridStrategy({
    brain,
    data: new GridDataProvider({ price: provider.price ?? provider.chain }),
    config: {
      lowerPriceCents: Math.round(lowerUsd * 100),
      upperPriceCents: Math.round(upperUsd * 100),
      gridCount: 5,
      capitalCents: Math.round(capUsd * 100),
      maxOrderSizeCents: Math.round(maxOrderUsd * 100),
    },
  });
} else if (STRATEGY === 'health') {
  const { HealthDataProvider, HealthStrategy } = await import('../packages/strategy-health/dist/index.js');
  strategy = new HealthStrategy({
    brain,
    data: new HealthDataProvider(provider.lending, provider.price),
    // Mirror production: owner-wallet-first (traced wallet arg if given).
    config: walletArg ? { userWalletAddress: walletArg } : undefined,
  });
} else if (STRATEGY === 'yield') {
  const { YieldDataProvider, YieldStrategy } = await import('../packages/strategy-yield/dist/index.js');
  strategy = new YieldStrategy({
    brain,
    data: new YieldDataProvider(provider.yield),
    network: 'bnb-mainnet',
    topN: 3,
  });
} else if (STRATEGY === 'lp') {
  const { LpDataProvider, LpStrategy } = await import('../packages/strategy-lp/dist/index.js');
  strategy = new LpStrategy({
    brain,
    data: new LpDataProvider({ liquidity: provider.liquidity, price: provider.price, chain: provider.chain }),
    config: undefined,
  });
} else {
  die(`Unknown strategy '${strategyArg}'. Choose grid | health | yield | lp`);
}

// ---- 7. Run the closed loop, printing each stage ----
console.log(`\n[trace] Strategy=${STRATEGY} mode=${live ? 'LIVE(bsc mainnet)' : 'DEV'}`);
try {
  const obs = await strategy.observe(agent, `trace_${Date.now()}`);
  console.log(`\n[trace] OBSERVED ${obs.length} observation(s)`);
  for (const o of obs) {
    console.log(`\n──── OBSERVATION (${o.type}) ────`);
    console.log(JSON.stringify(o.data, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2).slice(0, 3500));
  }

  console.log('\n[trace] DECIDING (sending to OpenRouter)…');
  const proposal = await strategy.decide(obs[0], agent);
  if (proposal === null) {
    console.log('\n[trace] DECISION → PASS (no action). The RAW response above shows why.');
  } else {
    console.log('\n[trace] DECISION → ACT');
    console.log('\n──── CANONICAL PROPOSAL (what would reach policy/execution) ────');
    console.log(JSON.stringify(proposal, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  }
  console.log('\n[trace] ✔ closed loop complete (observe → decide).');
} catch (err) {
  console.error(`\n[trace] ✘ CLOSED-LOOP ERROR: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}