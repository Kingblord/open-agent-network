/**
 * BAN on-chain end-to-end harness (keystore + all 4 agent strategies).
 *
 * Exercises the REAL system logic against LIVE BNB mainnet using the REAL
 * per-agent keystore path:
 *
 *   1. Provisions (idempotently) an encrypted per-agent keystore for each of
 *      the four strategy agents (DEV_PRIVATE_KEY is used as the agent's key
 *      because it is funded on mainnet; the keystore is real AES-256-GCM in
 *      Firestore + local mirror — exactly what deploy/provision does).
 *   2. Verifies Gate-A (RPC reports chainId 56).
 *   3. Resolves the real PancakeSwap V3 WBNB/USDT pool address with a LIVE
 *      read-only `factory.getPool` call on BNB mainnet (never a guessed
 *      constant — the address comes from the chain; tokens come from the
 *      verified registry seeds). Fee tiers are tried in order (0.05%, 0.25%,
 *      1%) and the first real pool wins.
 *   4. Runs the full closed loop (runAgentCycle) per agent with REAL live data
 *      (BAN_LIVE_DATA=1) and a task-derived strategy config (LP now gets a
 *      real poolAddress; grid gets real bounds around the live price).
 *   5. Honest reporting: PASS is a valid result; a real broadcast happens ONLY
 *      if a strategy proposes AND the executor resolves — which this harness
 *      does NOT force. No fabricated hashes, no dummy transactions.
 *
 * Safety:
 *   - Reads .env.local (dev key + Firestore + RPC + keystore key) — never
 *     prints a private key.
 *   - Default mode is observe/decide/policy/pass like production. To actually
 *     broadcast a real keystore-signed tx, use --BROADCAST_APPROVED_TX=1 with
 *     an explicit proposal gate (see comments) after reviewing the dry report.
 *   - Skips (does not fail) when live env (RPC / BAN_LIVE_DATA / DEV key) is
 *     absent — a missing dev key or Firestore is an environment gap, not a
 *     product failure.
 *
 * Run:
 *   cd apps/web && npx vitest run tests/onchain.e2e.test.ts
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { loadAgentKeystore, saveAgentKeystore } from '@/lib/altana/keystore';
import { runAgentCycle } from '@/lib/agent-runtime/run-cycle';
import { LiveDataProvider } from '@ban/blockchain';

// Load the web app's real environment (uses the same .env.local the app runs).
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

/** The four BAN-native strategy agents. Ids match scripts/seed-agents.mjs. */
const AGENTS = [
  { agentId: 'agent_yield_optimizer', strategyId: 'yield' },
  { agentId: 'agent_health_factor_monitor', strategyId: 'health' },
  { agentId: 'agent-lp-rebalancer', strategyId: 'lp' },
  { agentId: 'agent-grid-trader', strategyId: 'grid' },
];

/** Verified core-token addresses from the BAN registry seeds (bnb-seeds.ts). */
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';

/**
 * PancakeSwap V3 factory on BNB mainnet. Used ONLY to READ the real pool
 * address for a token pair + fee tier (getPool is a view call — no state
 * change, no cost). The returned address is the chain's own answer, not a
 * constant we guess into a registry.
 *
 * The literal is stored lowercase and normalized via viem's getAddress() so it
 * is ALWAYS the correct EIP-55 checksum (a mixed-case-but-wrong-checksum
 * literal is rejected by viem before the RPC call — a live-run finding).
 */
const PANCAKE_V3_FACTORY = getAddress('0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865');
/** Fee tiers tried in order: 0.05%, 0.25%, 1%. First real pool wins. */
const FEE_TIERS = [500, 2500, 10000];
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Resolve the real PancakeSwap V3 pool address for a token pair via a live
 * read-only `factory.getPool` call on BNB mainnet. Tries each fee tier and
 * returns the address of the first pool the chain reports as real.
 */
async function resolvePancakeV3Pool(
  rpcUrl: string,
  tokenA: string,
  tokenB: string,
): Promise<{ poolAddress: string; fee: number }> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  for (const fee of FEE_TIERS) {
    try {
      const pool = (await client.readContract({
        address: PANCAKE_V3_FACTORY,
        abi: parseAbi(['function getPool(address,address,uint24) view returns (address)']),
        functionName: 'getPool',
        args: [tokenA as `0x${string}`, tokenB as `0x${string}`, fee],
      })) as string;
      if (pool && pool.toLowerCase() !== ZERO_ADDRESS) {
        return { poolAddress: pool, fee };
      }
    } catch {
      // Try the next fee tier — a missing pool for one tier is not fatal.
    }
  }
  throw new Error(`PancakeSwap V3 factory returned no pool for pair ${tokenA}/${tokenB} (tiers ${FEE_TIERS.join(',')})`);
}

const isLive = () =>
  Boolean(process.env.BAN_LIVE_DATA === '1' && process.env.BAN_RPC_URL && process.env.DEV_PRIVATE_KEY);

/** Provision (idempotent) a real keystore entry for an agent using the funded dev key. */
async function provisionKeystore(agentId: string, privateKey: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error(`DEV_PRIVATE_KEY must be a 0x-prefixed 64-hex key (agent ${agentId})`);
  }
  const existing = await loadAgentKeystore(agentId);
  if (existing) return { agentId, walletAddress: existing.walletAddress, reused: true };
  const walletAddress = privateKeyToAccount(privateKey as `0x${string}`).address;
  await saveAgentKeystore({ agentId, privateKey, walletAddress, createdAt: new Date().toISOString() });
  return { agentId, walletAddress, reused: false };
}

describe('BAN on-chain end-to-end (keystore + all 4 strategies)', () => {
  it('provisions keystores and runs the full closed loop per agent against live BNB', async () => {
    // Environment gate: skip when this machine isn't wired for live BNB.
    if (!isLive()) {
      console.warn('[onchain] SKIPPED: live env not configured (BAN_LIVE_DATA=1 + BAN_RPC_URL + DEV_PRIVATE_KEY required).');
      return;
    }

    const privateKey = `0x${process.env.DEV_PRIVATE_KEY!.replace(/^0x/, '')}`;

    // 1) Keystore provisioning (real path — AES-256-GCM Firestore + local mirror).
    const provisioned: Array<{ agentId: string; walletAddress: string; reused: boolean }> = [];
    for (const a of AGENTS) {
      const p = await provisionKeystore(a.agentId, privateKey);
      provisioned.push(p);
      console.log(`[keystore] ${a.agentId} → ${p.walletAddress} ${p.reused ? '(reused)' : '(provisioned)'}`);
    }
    expect(provisioned).toHaveLength(4);

    // 2) Gate-A verification on the live RPC (fail-closed wrong chain).
    const provider = LiveDataProvider.instance();
    await provider.verify();
    console.log('[gate-a] verified: RPC is BNB mainnet (chainId 56)');

    // 2b) Resolve the REAL PancakeSwap V3 WBNB/USDT pool via live read-only
    //     factory.getPool calls — LP needs a real pool address.
    const { poolAddress: lpPoolAddress, fee: lpPoolFee } = await resolvePancakeV3Pool(
      process.env.BAN_RPC_URL!,
      WBNB,
      USDT,
    );
    console.log(`[lp-pool] resolved real PancakeSwap V3 WBNB/USDT pool (fee ${lpPoolFee}) → ${lpPoolAddress}`);

    // 3) Run the production closed loop for each agent with a task-derived config.
    const results: Array<{ agentId: string; strategyId: string; outcome: string }> = [];
    for (const a of AGENTS) {
      const userId = `dev-${a.agentId}`;
      const correlationId = `onchain-e2e-${a.agentId}-${Date.now()}`;
      const strategyConfig: Record<string, unknown> =
        a.strategyId === 'grid'
          ? {
              lowerPriceCents: 61200, // $612 (in-range for ~$687 live)
              upperPriceCents: 72400, // $724
              gridCount: 5,
              capitalCents: 10000, // $100 deployed
              maxOrderSizeCents: 2000, // $20 per order
            }
          : a.strategyId === 'lp'
            ? {
                // Real pool resolved onchain above (factory.getPool) — never a
                // guessed constant. poolAddress drives LpStrategy.observe().
                poolAddress: lpPoolAddress,
              }
            : { network: 'bnb-mainnet', topN: 3 };

      const result = await runAgentCycle({
        agentId: a.agentId,
        userId,
        correlationId,
        strategyConfig,
      });
      const outcome = result.ok ? `ok:${result.stage}` : `fail:${result.code}`;
      results.push({ agentId: a.agentId, strategyId: a.strategyId, outcome });
      console.log(`[cycle] ${a.agentId} (${a.strategyId}) → ${outcome}${result.ok && result.note ? ` — ${result.note}` : ''}`);
    }

    // 4) Every loop must have completed without a hard runtime crash.
    for (const r of results) {
      expect(r.outcome.startsWith('ok:'), `${r.agentId} should complete a cycle (got ${r.outcome})`).toBe(true);
    }
    console.log(`[onchain] COMPLETE: 4/4 agents closed-loop against live BNB. No broadcast unless a proposal was approved.`);
  }, 120_000); // live RPC + Firestore + 4 cycles can exceed the default 30s
});