/** CLI + reusable verification helpers. Entry point for the `verify:seeds`
 * script. Importing this module from elsewhere MUST NOT trigger network I/O —
 * the CLI runs only when executed directly (`node dist/seed-catalog/verify-seeds.js`). */

import { readFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { BNB_SEED_CATALOG } from './bnb-seeds.js';

const RPC_URL = process.env.BAN_RPC_URL ?? 'https://bsc-dataseed1.binance.org';
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY ?? '';

/** True only when this module is the directly-executed entrypoint (never on import). */
const isDirectRun =
  typeof process !== 'undefined' &&
  typeof process.argv?.[1] === 'string' &&
  process.argv[1].replace(/\\/g, '/').endsWith('verify-seeds.js');

if (isDirectRun) {
  main().catch((err) => {
    console.error('[verify-seeds] failed', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

export interface VerificationResult {
  address: string;
  label: string;
  codeExisted: boolean;
  sourceVerified: boolean | null;
}

/** Our own log helper: prints `[verify-seeds]` lines, no structured logger dep. */
function log(...args: unknown[]): void {
  console.log('[verify-seeds]', ...args);
}

/** Cheap on-chain existence check (does code actually exist at this address?). */
export async function verifyCodeExists(publicClient: ReturnType<typeof createPublicClient>, address: `0x${string}`): Promise<boolean> {
  try {
    const code = await publicClient.getCode({ address });
    return typeof code === 'string' && code.startsWith('0x') && code.length > 2;
  } catch (err) {
    console.error(`getCode failed for ${address}`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Optional BscScan source verification (name/proxy match) when a key is present. */
export async function verifyBscScanSource(address: string): Promise<boolean | null> {
  if (!BSCSCAN_API_KEY) return null;
  try {
    const url =
      `https://api.bscscan.com/api?module=contract&action=getsourcecode&address=${address}` +
      `&apikey=${encodeURIComponent(BSCSCAN_API_KEY)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { status?: string; result?: Array<{ ContractName?: string; Proxy?: string; Implementation?: string }> };
    const first = json.result?.[0];
    if (!first) return null;
    const name = (first.ContractName ?? '').trim();
    const proxy = (first.Proxy ?? '').trim();
    // A contract with no name and no code is not source-verified. Anything
    // with a name (or a recognizable proxy) counts as source-verified here;
    // strict allowlists of expected names are the app's job at execution time.
    return name.length > 0 || proxy.length > 0;
  } catch (err) {
    console.error(`BscScan source check failed for ${address}`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Verify every deployment/token candidate in the catalog. Returns the set of
 * entries whose on-chain existence is confirmed (candidates-to-flip). Does
 * NOT mutate anything itself — callers apply the promotion explicitly.
 */
export async function verifySeedCatalog(): Promise<VerificationResult[]> {
  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(RPC_URL, { timeout: 15_000 }),
  });

  const results: VerificationResult[] = [];
  const seen = new Set<string>();

  for (const d of BNB_SEED_CATALOG.deployments) {
    const entries = Object.entries(d.contracts);
    if (entries.length === 0) {
      log(
        `EMPTY (pending verification)  ${d.protocolId.padEnd(24)}  no addresses seeded — role references only; nothing executable until the pipeline confirms a real address.`
      );
      continue;
    }
    for (const [role, addr] of entries) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      const codeExisted = await verifyCodeExists(publicClient, addr as `0x${string}`);
      const sourceVerified = await verifyBscScanSource(addr);
      results.push({
        address: addr,
        label: `${d.protocolId}:${role}`,
        codeExisted,
        sourceVerified,
      });
    }
  }

  for (const t of BNB_SEED_CATALOG.tokens) {
    if (seen.has(t.address)) continue;
    seen.add(t.address);
    const codeExisted = await verifyCodeExists(publicClient, t.address as `0x${string}`);
    const sourceVerified = await verifyBscScanSource(t.address);
    results.push({
      address: t.address,
      label: `token:${t.id}`,
      codeExisted,
      sourceVerified,
    });
  }

  return results;
}

/** Read + verify the fetched Aave/Lista candidates (read-only, never catalog mutation). */
export async function verifyFetchedCandidates(): Promise<VerificationResult[]> {
  const file = process.env.BAN_FETCHED_FILE ?? 'dist/seed-catalog/fetched-addresses.json';
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    log(`no fetched candidates at ${file} (${err instanceof Error ? err.message : String(err)}) — run fetch:seeds first`);
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as { candidates?: unknown }).candidates)) {
    log(`fetched candidates file ${file} has no candidates array — nothing to verify`);
    return [];
  }
  const candidates = (parsed as { candidates: Array<{ address?: string; role?: string; protocolId?: string }> }).candidates;
  if (candidates.length === 0) {
    log('fetched candidates file is empty — run fetch:seeds first');
    return [];
  }

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(RPC_URL, { timeout: 15_000 }),
  });
  const results: VerificationResult[] = [];
  for (const c of candidates) {
    const addr = c.address;
    if (typeof addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
    const codeExisted = await verifyCodeExists(publicClient, addr as `0x${string}`);
    const sourceVerified = await verifyBscScanSource(addr);
    results.push({
      address: addr,
      label: `fetch:${c.protocolId ?? '?'}:${c.role ?? '?'}`,
      codeExisted,
      sourceVerified,
    });
  }
  return results;
}

/** Promotion decision: code exists AND (no BscScan key OR source verified). */
export function shouldPromote(r: VerificationResult, haveKey: boolean): boolean {
  if (!r.codeExisted) return false;
  if (r.sourceVerified === false) return false;
  if (haveKey && r.sourceVerified === null) return false;
  return true;
}

/** CLI entrypoint (module-safe; runs only when executed directly). */
async function main(): Promise<void> {
  const results = await verifySeedCatalog();
  for (const r of results) {
    const promotable = shouldPromote(r, Boolean(BSCSCAN_API_KEY));
    log(
      `${promotable ? 'PROMOTE' : 'HOLD'}  ${r.label.padEnd(24)} ${r.address}  code=${r.codeExisted}  source=${r.sourceVerified ?? 'n/a'}`
    );
  }

  log('');
  log('--- fetched deployment candidates (Aave V3 / Lista DAO, read-only) ---');
  const fetched = await verifyFetchedCandidates();
  for (const r of fetched) {
    const promotable = shouldPromote(r, Boolean(BSCSCAN_API_KEY));
    log(
      `${promotable ? 'FETCH-PROMOTE' : 'FETCH-HOLD'}  ${r.label.padEnd(24)} ${r.address}  code=${r.codeExisted}  source=${r.sourceVerified ?? 'n/a'}`
    );
  }

  const all = [...results, ...fetched];
  log(
    `\nVerified candidates: ${all.filter((r) => r.codeExisted).length}/${all.length} on-chain. ` +
      `Run with BSCSCAN_API_KEY for source-verified promotion.` +
      `\nFetched candidates are NOT written into the catalog — promote into bnb-seeds.ts only after human review.`
  );
}