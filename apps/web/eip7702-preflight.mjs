// apps/web/eip7702-preflight.mjs — READ-ONLY network preflight (no broadcast, no spend).
// Run from apps/web: node eip7702-preflight.mjs
//
// Verifies the configured dev key + RPC are ready for EIP-7702 activation WITHOUT
// signing or broadcasting anything:
//   1. derive the account address from DEV_PRIVATE_KEY (offline, no signature)
//   2. read its BNB balance + nonce over a WORKING BSC RPC (configured first,
//      public fallback if the configured one rejects core methods)
//   3. probe eth_supportedEntryTypes for 0x4 (EIP-7702 type-4 tx support)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const cwd = process.cwd();

// Tiny .env parser — no dotenv dependency needed.
function loadEnv(file) {
  const out = {};
  try {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1);
      out[key] = value;
    }
  } catch (err) {
    console.error('Failed to read env file:', err.message);
  }
  return out;
}

const env = loadEnv(join(cwd, '.env.local'));

const KEY = (env.DEV_PRIVATE_KEY || '').trim();
const configuredRPC = (env.BAN_RPC_URL || '').trim();
const CHAIN_ID = Number(env.BAN_CHAIN_ID ?? 56);

if (!KEY) {
  console.error('Missing DEV_PRIVATE_KEY in apps/web/.env.local');
  process.exit(1);
}
if (!/^(0x)?[a-fA-F0-9]{64}$/.test(KEY)) {
  console.error('DEV_PRIVATE_KEY does not look like a 64-hex private key.');
  process.exit(1);
}

const normalizedKey = KEY.startsWith('0x') ? KEY : '0x' + KEY;
const account = privateKeyToAccount(normalizedKey);
console.log('derived account:', account.address);
console.log('configured chainId:', CHAIN_ID);

// BSC MAINNET public RPCs (read-only fallback, no key needed).
const PUBLIC_RPCS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-rpc.publicnode.com',
];
const rpcs = configuredRPC ? [configuredRPC, ...PUBLIC_RPCS] : PUBLIC_RPCS;

const redact = (url) => url.replace(/(https?:\/\/[^/]+\/).*/, '$1<redacted>');

async function jsonRpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}

let workingRPC = null;

// 1) Find a working RPC (getBalance succeeds).
for (const rpc of rpcs) {
  try {
    const json = await jsonRpc(rpc, 'eth_getBalance', [account.address, 'latest']);
    if (json?.result && typeof json.result === 'string') {
      workingRPC = rpc;
      console.log('working RPC:', redact(rpc));
      console.log('balance (wei):', json.result);
      break;
    }
    console.log('RPC rejected core method:', redact(rpc), '->', json?.error?.message ?? 'no result');
  } catch (err) {
    console.log('RPC unreachable:', redact(rpc), '->', err.message);
  }
}

if (!workingRPC) {
  console.error('No working BSC RPC found — cannot verify balance/nonce or EIP-7702 support.');
  process.exit(1);
}

// 2) Nonce over the working RPC.
try {
  const json = await jsonRpc(workingRPC, 'eth_getTransactionCount', [account.address, 'latest']);
  console.log('nonce (tx count):', json?.result ?? json?.error?.message ?? 'unknown');
} catch (err) {
  console.log('nonce probe failed:', err.message);
}

// 3) EIP-7702 support probe (0x4 = type-4 tx) — try working RPC, then publicnode.
for (const rpc of [workingRPC, 'https://bsc-rpc.publicnode.com']) {
  try {
    const json = await jsonRpc(rpc, 'eth_supportedEntryTypes', [['0x0', '0x1', '0x2', '0x3', '0x4']]);
    if (json?.result) {
      console.log('eth_supportedEntryTypes:', Array.isArray(json.result) ? json.result.join(', ') : JSON.stringify(json.result));
      break;
    }
    console.log('eth_supportedEntryTypes not advertised by', redact(rpc), '->', json?.error?.message ?? JSON.stringify(json));
  } catch (err) {
    console.log('eth_supportedEntryTypes probe failed on', redact(rpc), '->', err.message);
  }
}

console.log('--- preflight complete (read-only; nothing signed or broadcast) ---');