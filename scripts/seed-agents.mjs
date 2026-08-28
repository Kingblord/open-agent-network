#!/usr/bin/env node
/**
 * BAN Smart Money — Seed the four first-class marketplace agents.
 *
 * Populates the Firestore `agents` collection with the four BAN Smart Money
 * first-class agents (Yield Optimisation, Health Factor Monitoring, LP
 * Rebalancing, Grid Trading) so the marketplace (`/agents` -> GET /api/agents)
 * can DISCOVER them through the real Agent Registry — never a hardcoded array
 * in the page (mustflow §3).
 *
 * Design rules honored:
 *   - Idempotent: agents already present are skipped (never duplicated).
 *   - Fail-closed: refuses to run without Firebase Admin credentials.
 *   - Honest data only: capabilities/protocols/risk reflect the real strategy
 *     packages; NO fabricated APY, P&L, performance, or AI confidence is written.
 *   - Consumers see real Firestore docs, exactly as the API returns them.
 *
 * Usage:
 *   node scripts/seed-agents.mjs
 *
 * Credentials are read from FIREBASE_* env vars (or apps/web/.env.local if
 * present), matching what firebase-admin.ts uses.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Load apps/web/.env.local into process.env (no extra dependency) --------
function loadEnv() {
  const p = path.join(__dirname, '..', 'apps', 'web', '.env.local');
  if (!existsSync(p)) return;
  const body = readFileSync(p, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    // strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    '✗ Firebase Admin is not configured.\n' +
      '  Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in apps/web/.env.local\n' +
      '  (or export them) before seeding.'
  );
  process.exit(1);
}

const normalizePrivateKey = (k) => k.replace(/\\n/g, '\n');

function getAdminApp() {
  const existing = getApps().find((a) => a.name === 'ban-seed');
  if (existing) return existing;
  return initializeApp(
    {
      credential: cert({
        projectId,
        clientEmail,
        privateKey: normalizePrivateKey(privateKey),
      }),
    },
    'ban-seed'
  );
}

// ---- The four first-class agents (BAN Smart Money) --------------------------
// Fields mirror AgentSchema from @ban/schemas. We only write real, descriptive
// metadata — never fabricated APY/performance/PnL/confidence. `type` and
// `strategyId` are opaque references so the registry stays strategy-agnostic
// (M3). `ownerId` is the trusted BAN platform identity (registered agents are
// first-class products, not user-created ones).
const AGENTS = [
  {
    id: 'agent_yield_optimizer',
    name: 'BAN Yield Optimizer',
    description:
      'Continuously scans BNB supply/yield opportunities (Venus, Aave, Lista), selects the best effective yield after fees/gas/slippage/risk, and proposes deterministic yield actions. Execution only after policy approval and a scoped session.',
    type: 'yield',
    strategyId: 'yield',
    ownerId: 'ban-smart-money',
    riskLevel: 'LOW',
    capabilities: [
      { id: 'READ_BALANCE', name: 'Read balance' },
      { id: 'READ_PRICE', name: 'Read price' },
      { id: 'READ_YIELD', name: 'Read yield' },
      { id: 'PROPOSE_SWAP', name: 'Propose swap' },
      { id: 'PROPOSE_LENDING_ACTION', name: 'Propose lending action' },
    ],
    protocols: ['pancakeswap', 'venus', 'aave', 'lista'],
  },
  {
    id: 'agent_health_factor_monitor',
    name: 'BAN Health Factor Monitor',
    description:
      'Watches lending positions (Venus, Aave, Lista) and calculates health factor continuously. Emits HEALTHY/WARNING/CRITICAL/EMERGENCY states and proposes protective actions before liquidation.',
    type: 'health',
    strategyId: 'health',
    ownerId: 'ban-smart-money',
    riskLevel: 'LOW',
    capabilities: [
      { id: 'READ_BALANCE', name: 'Read balance' },
      { id: 'READ_PRICE', name: 'Read price' },
      { id: 'READ_LENDING_POSITION', name: 'Read lending position' },
      { id: 'PROPOSE_LENDING_ACTION', name: 'Propose lending action' },
    ],
    protocols: ['venus', 'aave', 'lista'],
  },
  {
    id: 'agent-lp-rebalancer',
    name: 'BAN LP Rebalancer',
    description:
      'Manages concentrated PancakeSwap liquidity positions. Detects range inefficiency, calculates a deterministic candidate range, and proposes safe remove/reposition/add actions through the common execution engine.',
    type: 'lp',
    strategyId: 'lp',
    ownerId: 'ban-smart-money',
    riskLevel: 'HIGH',
    capabilities: [
      { id: 'READ_BALANCE', name: 'Read balance' },
      { id: 'READ_PRICE', name: 'Read price' },
      { id: 'READ_LP_POSITION', name: 'Read LP position' },
      { id: 'PROPOSE_LP_REBALANCE', name: 'Propose LP rebalance' },
    ],
    protocols: ['pancakeswap'],
  },
  {
    id: 'agent-grid-trader',
    name: 'BAN Grid Trader',
    description:
      'Runs a bounded grid strategy within configured lower/upper price, grid count, capital and stop conditions. Generates deterministic grid signals and proposes swaps to keep orders in range without exceeding limits.',
    type: 'grid',
    strategyId: 'grid',
    ownerId: 'ban-smart-money',
    riskLevel: 'MEDIUM',
    capabilities: [
      { id: 'READ_BALANCE', name: 'Read balance' },
      { id: 'READ_PRICE', name: 'Read price' },
      { id: 'PROPOSE_GRID_ORDER', name: 'Propose grid order' },
    ],
    protocols: ['pancakeswap'],
  },
];

async function main() {
  const adminApp = getAdminApp();
  const db = getFirestore(adminApp);
  const col = db.collection('agents');
  let created = 0;
  let skipped = 0;

  for (const agent of AGENTS) {
    const ref = col.doc(agent.id);
    const snap = await ref.get();
    if (snap.exists) {
      console.log(`• ${agent.id} — already registered (skip)`);
      skipped += 1;
      continue;
    }
    const now = new Date().toISOString();
    await ref.set({
      ...agent,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      // walletAddress intentionally omitted — we never fabricate authority.
      // A real wallet/session is wired through the activation path.
    });
    console.log(`✓ ${agent.id} — registered & ACTIVE`);
    created += 1;
  }

  console.log(`\nDone. ${created} created, ${skipped} already present.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Seed failed:', err.message || err);
  process.exit(1);
});