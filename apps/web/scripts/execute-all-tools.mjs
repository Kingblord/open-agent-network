/**
 * execute-all-tools.mjs — trigger EVERY BAN agent's full closed loop for real
 * on-chain execution, programmatically.
 *
 * WHAT IT DOES (honest, real, nothing fabricated):
 *   1. Reads apps/web/.env.local (FIREBASE_* + BAN_* + JWT_SECRET + keys).
 *   2. Queries Firestore `agents` — the REAL control-plane registry — and for
 *      every agent resolves its REAL wallet:
 *        a. `agent_keystores/<agentId>` (encrypted, decrypted with
 *           BAN_KEYSTORE_ENCRYPTION_KEY) — the authoritative production key,
 *        b. fallback: `agent.walletAddress` field on the agent doc.
 *   3. FUNDING GATE (the whole point of "check the database for agents with
 *      funded wallets"): live on-chain check of the agent wallet:
 *        - BNB  ≥ MIN_BNB_GAS (0.002)  — needed to pay the Altana relay/userOp
 *          gas + the KeyStore registration fee (≈0.00066 BNB).
 *        - USDT (and/or USDC) > 0       — actual funds the agent can deploy.
 *      Agents failing the gate are listed with the exact shortfall. Nothing is
 *      triggered for them (honest skip, not a fake run).
 *   4. For every PASSING agent: mints a REAL owner JWT (from JWT_SECRET +
 *      the agent's `ownerId` + email) and POSTs to
 *      POST /api/agents/:id/run  (the same route Inngest/UI use) so the REAL
 *      closed loop runs: OBSERVE → REASON → PROPOSE → POLICY → EXECUTE →
 *      POSITION → PERFORMANCE → AUDIT, with the real per-agent keystore/wallet.
 *   5. Prints verbatim per-agent: wallet, balances, gate verdict, and the full
 *      cycle result (stage / executionId / note / transactionHash).
 *
 * USAGE:
 *   node apps/web/scripts/execute-all-tools.mjs
 *     --host http://localhost:3000        (default)
 *     --agent <id>                        (trigger only one agent)
 *     --min-bnb 0.002                     (gas floor, default 0.002 BNB)
 *     --no-trigger                        (scan + gate only — no cycles)
 *
 * The local Next server must be running (pnpm --filter ban-web dev) so the
 * /api/agents/:id/run route is reachable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createDecipheriv, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------- env loader
function loadEnv() {
  const here = process.cwd();
  const candidates = [
    path.join(here, '.env.local'),
    path.join(here, 'apps', 'web', '.env.local'),
    path.join(here, 'web', '.env.local'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const out = {};
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      let value = t.slice(eq + 1).trim();
      // Strip matching surrounding quotes (Next/process.env semantics)
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[t.slice(0, eq).trim()] = value;
    }
    return out;
  }
  throw new Error('.env.local not found — run from repo root or apps/web');
}

const env = loadEnv();

// ---------------------------------------------------------------- firebase
function normalizePrivateKey(key) {
  const trimmed = key.trim();
  const unescape = (p) => p.replace(/\\n/g, '\n');
  if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(trimmed)) return unescape(trimmed);
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(decoded)) return unescape(decoded);
  } catch {}
  return unescape(trimmed);
}

function getDb() {
  const existing = getApps();
  const app =
    existing.find((a) => a.name === 'ban-script') ??
    initializeApp(
      {
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: normalizePrivateKey(env.FIREBASE_PRIVATE_KEY),
        }),
      },
      'ban-script',
    );
  return getFirestore(app);
}

// ---------------------------------------------------------------- keystore decrypt (mirror of lib/altana/keystore.ts)
function keystoreEncryptionKey() {
  const raw = env.BAN_KEYSTORE_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return createHash('sha256').update(trimmed).digest();
}

function decryptKeystoreDoc(doc, agentId) {
  try {
    const key = keystoreEncryptionKey();
    if (!key) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(doc.authTag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(doc.encryptedKey, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plain);
    if (!parsed || parsed.agentId !== doc.agentId || !parsed.privateKey || !parsed.walletAddress) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- live balances (raw RPC — no viem needed)
const RPC = env.BAN_RPC_URL || 'https://bsc-dataseed.binance.org';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function walletBalances(addr) {
  const out = { bnb: 0, usdt: 0, usdc: 0 };
  try {
    const bal = await rpc('eth_getBalance', [addr, 'latest']);
    out.bnb = Number(BigInt(bal)) / 1e18;
  } catch (e) {
    out.bnb = -1; // read failed → honest unknown
  }
  const tokenRead = async (token) => {
    try {
      const data = `0x70a08231000000000000000000000000${addr.slice(2).toLowerCase()}`;
      const hex = await rpc('eth_call', [{ to: token, data }, 'latest']);
      return Number(BigInt(hex)) / 1e18;
    } catch {
      return -1;
    }
  };
  out.usdt = await tokenRead(USDT);
  out.usdc = await tokenRead(USDC);
  return out;
}

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const HOST = opt('--host', 'http://localhost:3000').replace(/\/$/, '');
const ONLY_AGENT = opt('--agent', null);
const MIN_BNB = Number(opt('--min-bnb', '0.002'));
const NO_TRIGGER = args.includes('--no-trigger');
const MIN_TOKEN_USD = 0.5; // below $0.50 it's dust — cannot deploy meaningfully

// ---------------------------------------------------------------- main
async function main() {
  const db = getDb();
  const agentsSnap = await db.collection('agents').get();
  const agents = [];
  agentsSnap.forEach((d) => {
    const a = { id: d.id, ...d.data() };
    agents.push(a);
  });
  if (agents.length === 0) {
    console.log('NO AGENTS in Firestore agents collection.');
    process.exit(0);
  }

  console.log(`\n=== BAN EXECUTE-ALL-TOOLS (agents in DB: ${agents.length}) ===`);
  console.log(`host=${HOST}  minBnb=${MIN_BNB}  minTokenUsd=${MIN_TOKEN_USD}  trigger=${NO_TRIGGER ? 'OFF' : 'ON'}\n`);

  const gateResults = [];
  for (const agent of agents) {
    // real wallet: keystore first (authoritative), then agent.walletAddress
    let wallet = agent.walletAddress ?? null;
    let keySource = 'agent.walletAddress';
    try {
      const ksSnap = await db.collection('agent_keystores').doc(agent.id).get();
      if (ksSnap.exists) {
        const decrypted = decryptKeystoreDoc(ksSnap.data(), agent.id);
        if (decrypted?.walletAddress) {
          wallet = decrypted.walletAddress;
          keySource = 'agent_keystores (decrypted)';
        }
      }
    } catch {
      // fall through to agent.walletAddress / below
    }

    // local .altana mirror fallback
    if (!wallet) {
      try {
        const mirror = path.join(process.cwd(), '.altana', agent.id, 'key.json');
        if (fs.existsSync(mirror)) {
          const k = JSON.parse(fs.readFileSync(mirror, 'utf8'));
          if (k.walletAddress) {
            wallet = k.walletAddress;
            keySource = '.altana mirror';
          }
        }
      } catch {}
    }

    const rec = {
      id: agent.id,
      type: agent.type ?? agent.strategyId ?? '?',
      ownerId: agent.ownerId ?? null,
      status: agent.status ?? '?',
      wallet: wallet,
      keySource,
      balances: null,
      gate: 'UNKNOWN',
      note: '',
    };
    gateResults.push(rec);

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      rec.gate = 'SKIP';
      rec.note = 'no wallet address (keystore + agent.walletAddress both missing)';
      continue;
    }

    rec.balances = await walletBalances(wallet.toLowerCase());
    const b = rec.balances;
    const stables = (b.usdt > 0 ? b.usdt : 0) + (b.usdc > 0 ? b.usdc : 0);

    if (b.bnb < 0 || b.usdt < 0 || b.usdc < 0) {
      rec.gate = 'SKIP';
      rec.note = 'balance read failed (RPC) — cannot verify funding';
      continue;
    }
    if (b.bnb < MIN_BNB) {
      rec.gate = 'UNFUNDED_GAS';
      rec.note = `BNB ${b.bnb.toFixed(6)} < ${MIN_BNB} (gas+registration floor)`;
      continue;
    }
    if (stables < MIN_TOKEN_USD) {
      rec.gate = 'UNFUNDED_TOKENS';
      rec.note = `USDT+USDC $${stables.toFixed(2)} < $${MIN_TOKEN_USD} (no funds to deploy)`;
      continue;
    }
    rec.gate = 'PASS';
    rec.note = 'funded: BNB + stables present';
  }

  // ------------------------------------------------------------ print gate
  console.log('AGENT   TYPE    STATUS  WALLET            BNB      USDT    USDC   GATE  NOTE');
  console.log('─'.repeat(105));
  for (const r of gateResults) {
    const b = r.balances;
    console.log(
      `${String(r.id).padEnd(18)} ${String(r.type).padEnd(7)} ${String(r.status || '').padEnd(8)} ` +
        `${(r.wallet ?? '—').slice(0, 10).padEnd(10)} ` +
        `${b ? b.bnb.toFixed(5) : '—'} ${b ? b.usdt.toFixed(4) : '—'} ${b ? b.usdc.toFixed(4) : '—'}  ` +
        `${r.gate.padEnd(14)} ${r.note}`,
    );
  }

  if (NO_TRIGGER) {
    console.log('\n--no-trigger: scan only, no cycles started.\n');
    return;
  }

  // ------------------------------------------------------------ trigger
  const passing = gateResults.filter((r) => r.gate === 'PASS');
  if (ONLY_AGENT) {
    const wanted = gateResults.find((r) => r.id === ONLY_AGENT);
    if (!wanted) {
      console.log(`\nAgent '${ONLY_AGENT}' not found in DB.`);
      process.exit(1);
    }
    if (wanted.gate !== 'PASS') {
      console.log(`\nAgent '${ONLY_AGENT}' gate = ${wanted.gate}: ${wanted.note}. Not triggered.`);
      process.exit(0);
    }
    passing.length = 0;
    passing.push(wanted);
  }
  if (passing.length === 0) {
    console.log('\nNO FUNDED AGENT to trigger. Fund a wallet (BNB + USDT/USDC) and re-run.\n');
    return;
  }

  console.log(`\n=== TRIGGERING ${passing.length} FUNDED AGENT(S) — POST ${HOST}/api/agents/:id/run ===\n`);
  for (const r of passing) {
    const owner = r.ownerId;
    if (!owner) {
      console.log(`[${r.id}] SKIP: no ownerId in DB — cannot mint owner JWT.\n`);
      continue;
    }
    // Owner JWT exactly as the app signs it (JWTPayload { developerId, email }).
    const token = jwt.sign(
      { developerId: owner, email: `${owner}@ban.local` },
      env.JWT_SECRET || 'fallback-secret-do-not-use-in-production',
      { expiresIn: '7d' },
    );

    console.log(`>>> ${r.id} (${r.type}) wallet=${r.wallet}`);
    try {
      const res = await fetch(`${HOST}/api/agents/${r.id}/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      console.log(`    HTTP ${res.status}`);
      try {
        const j = JSON.parse(text);
        console.log('    RESULT:', JSON.stringify(j, null, 2));
      } catch {
        console.log('    RAW:', text.slice(0, 2000));
      }
    } catch (err) {
      console.log(`    TRIGGER ERROR: ${err.message}`);
      console.log('    (is the Next server running at ' + HOST + '?)');
    }
    console.log('');
  }

  console.log('=== DONE ===');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});