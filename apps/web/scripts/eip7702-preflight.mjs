// apps/web/scripts/eip7702-preflight.mjs — READ-ONLY network preflight (no broadcast, no spend).
// Run from apps/web: node scripts/eip7702-preflight.mjs
//
// Verifies the configured dev key + RPC are ready for EIP-7702 activation WITHOUT
// signing or broadcasting anything:
//   1. derive the account address from DEV_PRIVATE_KEY (offline, no signature)
//   2. read its BNB balance + nonce (read-only RPC calls)
//   3. probe eth_supportedEntryTypes for 0x4 (EIP-7702 type-4 tx support)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, '..');

// Tiny .env parser — no dotenv dependency needed here.
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

const env = loadEnv(join(webRoot, '.env.local'));

const KEY = (env.DEV_PRIVATE_KEY || '').trim();
const RPC = (env.BAN_RPC_URL || '').trim();
const CHAIN_ID = Number(env.BAN_CHAIN_ID ?? 56);

if (!KEY || !RPC) {
  console.error('Missing DEV_PRIVATE_KEY and/or BAN_RPC_URL in apps/web/.env.local');
  process.exit(1);
}
if (!/^(0x)?[a-fA-F0-9]{64}$/.test(KEY)) {
  console.error('DEV_PRIVATE_KEY does not look like a 64-hex private key.');
  process.exit(1);
}

const account = privateKeyToAccount('0x' + KEY.replace(/^0x/, ''));
console.log('derived account:', account.address);
console.log('configured chainId:', CHAIN_ID);
console.log('rpc endpoint:', RPC.replace(/(https?:\/\/[^/]+\/).*/, '$1<redacted>'));

const publicClient = createPublicClient({ transport: http(RPC) });

const [balance, nonce] = await Promise.all([
  publicClient
    .getBalance({ address: account.address })
    .then((b) => b.toString())
    .catch((e) => 'ERR ' + e.message),
  publicClient
    .getTransactionCount({ address: account.address })
    .then((n) => n.toString())
    .catch((e) => 'ERR ' + e.message),
]);

console.log('balance (wei):', balance);
console.log('nonce (tx count):', nonce);

// EIP-7702 support probe — read-only JSON-RPC (0x4 = type-4 / EIP-7702 tx).
try {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_supportedEntryTypes',
      params: [['0x0', '0x1', '0x2', '0x3', '0x4']],
    }),
  });
  const json = await res.json();
  if (json?.result) console.log('eth_supportedEntryTypes:', Array.isArray(json.result) ? json.result.join(', ') : JSON.stringify(json.result));
  else console.log('eth_supportedEntryTypes probe:', JSON.stringify(json?.error ?? json));
} catch (err) {
  console.log('eth_supportedEntryTypes probe failed:', err.message);
}

console.log('--- preflight complete (read-only; nothing signed or broadcast) ---');