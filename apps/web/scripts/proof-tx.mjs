#!/usr/bin/env node
/**
 * BAN Real Mainnet Proof Transaction — Direct Path
 *
 * Fastest way to prove a real onchain BNB Chain transaction:
 *   1. Derives account from DEV_PRIVATE_KEY
 *   2. Sends 0.0001 BNB to a recipient (or back to itself)
 *   3. Waits for confirmation
 *   4. Prints the explorer link
 *
 * Usage:
 *   node scripts/proof-tx.mjs [recipient]
 *
 * If no recipient is provided, sends to the dev wallet itself (self-transfer).
 * Requires DEV_PRIVATE_KEY and BAN_RPC_URL in apps/web/.env.local.
 *
 * Safety:
 *   - Uses minimal amount (0.0001 BNB ≈ $0.06)
 *   - Only runs with explicit DEV_PRIVATE_KEY
 *   - Prints explorer link for verification
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────
function loadEnv() {
  // When run from apps/web/scripts/, look one directory up for .env.local
  const p = path.join(__dirname, '..', '.env.local');
  if (!existsSync(p)) {
    console.error('✗ apps/web/.env.local not found');
    process.exit(1);
  }
  const body = readFileSync(p, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

const DEV_KEY = (process.env.DEV_PRIVATE_KEY || '').startsWith('0x')
  ? process.env.DEV_PRIVATE_KEY
  : `0x${process.env.DEV_PRIVATE_KEY || ''}`;
const RPC_URL = process.env.BAN_RPC_URL || 'https://bsc-dataseed.binance.org/';
const recipient = process.argv[2] || null; // self-transfer if no recipient

if (!DEV_KEY) {
  console.error('✗ DEV_PRIVATE_KEY not set in apps/web/.env.local');
  process.exit(1);
}

async function main() {
  // Dynamic imports for ESM
  const { createPublicClient, createWalletClient, http, parseGwei, formatEther, parseEther } = await import('viem');
  const { bsc } = await import('viem/chains');
  const { privateKeyToAccount } = await import('viem/accounts');

  const account = privateKeyToAccount(DEV_KEY);
  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPC_URL) });

  console.log('═══════════════════════════════════════════════════');
  console.log('  BAN REAL MAINNET PROOF TRANSACTION');
  console.log('═══════════════════════════════════════════════════\n');

  // Step 1: Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  Wallet:    ${account.address}`);
  console.log(`  Balance:   ${formatEther(balance)} BNB`);
  console.log(`  Chain:     BNB Mainnet (${bsc.id})`);
  console.log(`  RPC:       ${RPC_URL}\n`);

  if (balance < parseEther('0.0005')) {
    console.error('  ✗ Insufficient balance. Need at least 0.0005 BNB for gas.');
    process.exit(1);
  }

  // Step 2: Send proof transaction
  const to = recipient || account.address; // self-transfer if no recipient
  const amount = parseEther('0.0001');

  console.log(`  Sending ${formatEther(amount)} BNB to ${to}...`);
  const hash = await walletClient.sendTransaction({
    to,
    value: amount,
  });
  console.log(`  TX Hash:   ${hash}`);

  // Step 3: Wait for confirmation
  console.log('  Waiting for confirmation...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(`\n  ✅ CONFIRMED`);
  console.log(`  Block:     ${receipt.blockNumber}`);
  console.log(`  Gas Used:  ${receipt.gasUsed}`);
  console.log(`  Status:    ${receipt.status}`);

  // Step 4: Explorer link
  console.log(`\n  🔗 https://bscscan.com/tx/${hash}`);
  console.log(`  🔗 https://bscscan.com/address/${account.address}\n`);

  // Step 5: Final balance
  const finalBalance = await publicClient.getBalance({ address: account.address });
  console.log(`  Final Balance: ${formatEther(finalBalance)} BNB`);
  console.log(`  Cost:          ${formatEther(balance - finalBalance)} BNB\n`);

  console.log('═══════════════════════════════════════════════════');
  console.log('  ✅ REAL MAINNET PROOF — BNB Chain (chainId 56)');
  console.log('═══════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('✗ Fatal error:', err);
  process.exit(1);
});
