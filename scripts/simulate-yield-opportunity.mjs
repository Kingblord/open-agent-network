/**
 * SIMULATE YIELD OPPORTUNITY — see EXACTLY what the yield agent does with a
 * REAL-TIME (simulated-but-live-priced) high-APY opportunity, verbatim.
 *
 * Injects a USDC Venus opportunity with a fat APY into the agent's
 * observation (the same shape the live provider emits), then runs the REAL
 * closed loop:
 *   1. observe (live BSC reads for the wallet + enrichment)
 *   2. decide (REAL OpenRouter brain — full prompt + raw response printed)
 *   3. canonical proposal (deterministic execution fields, user-wallet-aware)
 *   4. FUEL REBALANCE CHECK — compares the proposal's underlying token
 *      against the AGENT WALLET's REAL on-chain balances; if the wallet holds
 *      a different stablecoin, prints the exact swap calls that would be
 *      broadcast first (approve+exactInputSingle via PancakeSwap V3).
 *
 * Usage:
 *   node scripts/simulate-yield-opportunity.mjs [--token USDC] [--apr 88.5]
 *       [--wallet 0x...] [--funder-user 0xaaC9...]
 *
 * Reads apps/web/.env.local (OPENROUTER_API_KEY, BAN_RPC_URL, BAN_LIVE_DATA).
 * Prints prompts/responses — nothing is broadcast.
 */
import { config as dotenv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), 'apps/web/.env.local');
if (fs.existsSync(envPath)) dotenv({ path: envPath });
else console.warn('[sim] apps/web/.env.local not found — using process env only.');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const TOKEN = String(flag('token', 'USDC')).toUpperCase();
const APR = Number(flag('apr', '88.5'));
const OWNER_WALLET = args.find((a) => /^0x[a-fA-F0-9]{40}$/.test(a));

function die(msg) { console.error(`\n[sim] ${msg}`); process.exit(1); }

const UNDERLYING = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  BNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
};
const VTOKENS = {
  USDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  USDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  BNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
};

if (!UNDERLYING[TOKEN]) die(`Token must be USDT|USDC|BNB, got ${TOKEN}`);

// Traced fetch: print the exact OpenRouter exchange.
const realFetch = globalThis.fetch;
const tracedFetch = async (url, init) => {
  try {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (body) {
      console.log('\n════════ PROMPT SENT TO OPENROUTER ════════');
      console.log(`model=${body.model}`);
      const sys = body.messages?.[0]?.content;
      console.log('── system (first 1800 chars) ──');
      console.log(Array.isArray(sys) ? sys.join('\n').slice(0, 1800) : String(sys ?? '').slice(0, 1800));
      const usr = body.messages?.[1]?.content;
      console.log('\n── user (first 2200 chars) ──');
      console.log(Array.isArray(usr) ? usr.join('\n').slice(0, 2200) : String(usr ?? '').slice(0, 2200));
    }
  } catch { /* not JSON — keep going */ }
  const res = await realFetch(url, init);
  const text = await res.text();
  console.log('\n════════ RAW OPENROUTER RESPONSE (verbatim) ════════');
  console.log(text.slice(0, 3500) + (text.length > 3500 ? `\n…[truncated ${text.length} chars total]` : ''));
  return new Response(text, { status: res.status, headers: res.headers });
};

// ---- Agent fixture (yield) ----
const agent = {
  id: 'agent_yield_sim',
  name: 'Trace Yield (simulated opportunity)',
  description: 'trace run with injected opportunity',
  type: 'yield',
  ownerId: 'trace-owner',
  walletAddress: '0x0000000000000000000000000000000000000000',
  status: 'ACTIVE',
  capabilities: [{ id: 'PROPOSE_DEPOSIT', name: 'Deposit' }],
  protocols: ['venus'],
  riskLevel: 'LOW',
  strategyId: 'yield',
  createdAt: new Date().toISOString(),
};

const { LiveDataProvider } = await import('../packages/blockchain/dist/index.js');
const { OpenRouterBrainAdapter } = await import('../packages/ai/dist/index.js');

const live = process.env.BAN_LIVE_DATA === '1';
if (!live) console.warn('\n[sim] BAN_LIVE_DATA != 1 — using DEV provider (no real RPC). Set BAN_LIVE_DATA=1 for live reads.');
const provider = live ? LiveDataProvider.instance() : (await import('../packages/blockchain/dist/index.js')).DevDataProvider.instance();

const { YieldDataProvider, YieldStrategy } = await import('../packages/strategy-yield/dist/index.js');
const brain = new OpenRouterBrainAdapter({ fetch: tracedFetch });
const strategy = new YieldStrategy({
  brain,
  data: new YieldDataProvider(provider.yield),
  network: 'bnb-mainnet',
  topN: 5,
  config: {
    ...(OWNER_WALLET ? { userWalletAddress: OWNER_WALLET } : {}),
    network: 'BNB Smart Chain',
    maxTxUsd: flag('budget-usd', '4'),
  },
});

console.log(`\n[sim] yield sim: injected ${TOKEN} opportunity @ ${APR}% APR | owner-wallet=${OWNER_WALLET ?? 'none'}`);

// ---- 1. OBSERVE (live) ----
const obs = await strategy.observe(agent, `sim_${Date.now()}`);
console.log(`\n[sim] observed ${obs.length} observation(s) from live provider`);

// ---- 2. INJECT the simulated opportunity into the observation ----
// The live observation's candidates are the source of truth for the
// canonicalizer. We APPEND our simulated high-APY opportunity (same shape as
// YieldDataProvider emits) so the brain has a fat target to ACT on.
const simulatedCandidate = {
  protocol: 'venus',
  asset: TOKEN,
  address: VTOKENS[TOKEN],
  underlying: UNDERLYING[TOKEN],
  apr: String(APR),
  apy: String(APR),
  risk: 'MEDIUM',
  tvlUsd: '1250000000',
  rank: 0,
  action: 'DEPOSIT',
  amountCentsUsd: '50000', // $500
  denomination: TOKEN,
};
for (let i = 0; i < obs.length; i++) {
  const o = obs[i];
  if (o?.data && typeof o.data === 'object') {
    if (Array.isArray(o.data.candidates)) {
      o.data.candidates.unshift(simulatedCandidate);
      console.log(`\n[sim] INJECTED candidate into observation[${i}]:`);
      console.log(JSON.stringify(simulatedCandidate, null, 2));
    }
  }
  console.log(`\n──── OBSERVATION[${i}] (${o.type}) — candidates ${o?.data?.candidates?.length ?? '?'} ────`);
  console.log(JSON.stringify(o.data, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2).slice(0, 3000));
}

// ---- 3. DECIDE (real brain, now with the fat opportunity) ----
console.log('\n[sim] DECIDING (sending to OpenRouter)…');
const proposal = await strategy.decide(obs[0], agent);
if (proposal === null) {
  console.log('\n[sim] DECISION → PASS (no action). The RAW response above shows why.');
  process.exit(0);
}

console.log('\n[sim] DECISION → ACT');
console.log('\n──── CANONICAL PROPOSAL (deterministic, user-wallet-aware) ────');
console.log(JSON.stringify(proposal, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

// ---- 4. FUEL REBALANCE CHECK (REAL on-chain wallet balances) ----
console.log('\n════════ FUEL REBALANCE CHECK ════════');
const amountWei = BigInt(proposal.amount ?? '0');
const underlying = String(proposal.params?.underlying ?? proposal.token ?? '').toLowerCase();
const walletAddr = OWNER_WALLET; // trace: check the SIMULATED agent wallet
console.log(`action=${proposal.function}  underlying=${underlying.slice(0, 10)}…  amountWei=${amountWei}  (` +
  `$ ${String(Number(amountWei) / 1e18)} ${TOKEN})`);

// Read the wallet's real balances (if an address was given).
if (walletAddr && /^0x[a-fA-F0-9]{40}$/i.test(walletAddr)) {
  const { createPublicClient, http, parseAbi, formatUnits } = await import('viem');
  const { bsc } = await import('viem/chains');
  const client = createPublicClient({ chain: bsc, transport: http(process.env.BAN_RPC_URL || 'https://bsc-dataseed.binance.org') });
  const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const w = walletAddr.toLowerCase();
  const held = {};
  for (const [sym, addr] of Object.entries(UNDERLYING)) {
    try {
      const bal = await client.readContract({ address: addr, abi: ERC20, functionName: 'balanceOf', args: [w] });
      held[sym] = Number(formatUnits(bal, 18));
    } catch { held[sym] = -1; }
  }
  try { held.BNB = Number(formatUnits(await client.getBalance({ address: w }), 18)); } catch {}
  console.log(`wallet ${w.slice(0, 12)}… balances:`, JSON.stringify(held));

  const needSym = proposal.asset?.toUpperCase() ?? TOKEN;
  const haveSym = needSym === 'USDC' ? 'USDT' : needSym === 'USDT' ? 'USDC' : null;
  if (haveSym && held[needSym] !== undefined && held[haveSym] !== undefined) {
    const need = Number(amountWei) / 1e18;
    console.log(`\nfuel check: needs ${need.toFixed(2)} ${needSym}, holds ${held[needSym].toFixed(2)} ${needSym} / ${held[haveSym].toFixed(2)} ${haveSym}`);
    if (held[needSym] < need && held[haveSym] > 0.5) {
      const swapUsd = Math.min(Math.ceil((need - held[needSym]) * 1.02 * 100) / 100, held[haveSym]);
      console.log(`\n>> FUEL REBALANCE WOULD TRIGGER: swap ≈ ${swapUsd.toFixed(2)} ${haveSym} → ${needSym}`);
      console.log('   [approve ' + haveSym + ' → PancakeSwap V3 router] + [exactInputSingle ' + haveSym + '/' + needSym + ']');
      console.log('   (built by buildPancakeV3SwapCalls + broadcast by sendAndWait BEFORE the ' + proposal.function + ' call)');
    } else {
      console.log('\n>> NO fuel rebalance needed — wallet already holds the underlying.');
    }
  } else {
    console.log(`\n>> no wallet address to check fuel (pass a real agent wallet to see the on-chain balances).`);
  }
} else {
  console.log('\n>> no wallet address given — fuel rebalance check skipped (pass --wallet <agent wallet>).');
}

console.log('\n[sim] ✔ closed loop complete (observe → inject → decide → canonicalize → fuel check).');