/**
 * Rate-limited, cached Etherscan V2 API client for BNB Smart Chain (chainid 56).
 *
 * The legacy `api.bscscan.com` v1 endpoint is deprecated — this module uses the
 * unified Etherscan V2 endpoint (`https://api.etherscan.io/v2/api?chainid=56`)
 * with one key across all supported chains.
 *
 * FREE-PLAN BUDGET (per docs.etherscan.io):
 *   - 5 calls/sec   → this client serialises requests with a 300ms minimum gap
 *                     (≈3.3 calls/sec) to stay safely under the cap.
 *   - 100,000 calls/day → responses are cached per (module,action,params) with a
 *                     TTL so page refreshes and multiple viewers don't re-spend
 *                     quota. In-flight requests are deduplicated.
 *
 * Server-only: read via route handlers, never from the browser.
 */

const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';
const BSC_CHAIN_ID = 56;

/** Minimum milliseconds between upstream API calls (free plan: 5/s → we do ~3/s). */
const MIN_CALL_INTERVAL_MS = 300;

/** Default cache TTL for transaction-history reads. */
const HISTORY_CACHE_TTL_MS = 30_000;

export interface EtherscanNormalTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  txReceiptStatus: string;
}

export interface EtherscanTokenTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimal: string;
  gasUsed?: string;
  gasPrice?: string;
}

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

// ---------------------------------------------------------------------------
// Rate-limit queue: serialises upstream calls with a minimum interval.
// ---------------------------------------------------------------------------
let queueTail: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return task();
  };
  const next = queueTail.then(run, run);
  // Keep the chain alive even if a task rejects.
  queueTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// ---------------------------------------------------------------------------
// Cache: TTL per request key + in-flight dedupe.
// ---------------------------------------------------------------------------
interface CacheEntry {
  data: unknown;
  expiresAt: number;
}
const cache = new Map<string, { entry: CacheEntry }>();
const inflight = new Map<string, Promise<unknown>>();

function cachedOrFetch<T>(key: string, fetcher: () => Promise<T | null>, ttlMs: number): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.entry.expiresAt > Date.now()) {
    return Promise.resolve(hit.entry.data as T);
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T | null>;

  const p = (async (): Promise<T | null> => {
    try {
      const data = await fetcher();
      if (data !== null) {
        cache.set(key, { entry: { data, expiresAt: Date.now() + ttlMs } });
      }
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------
async function etherscanRequest<T>(
  module: string,
  action: string,
  params: Record<string, string | number>,
  ttlMs: number,
): Promise<T | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY || '';
  const url = new URL(ETHERSCAN_V2_BASE);
  url.searchParams.set('chainid', String(BSC_CHAIN_ID));
  url.searchParams.set('module', module);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (apiKey) url.searchParams.set('apikey', apiKey);

  const key = url.toString();
  return cachedOrFetch<T>(key, () => schedule(async () => {
    try {
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null; // 429/5xx → treat as unavailable, keep serving cache
      const json = (await res.json()) as EtherscanResponse<T>;
      // Etherscan returns status "0" both for "no transactions" and errors.
      // Array results (possibly empty) are success; string results are errors.
      if (Array.isArray(json.result)) return json.result;
      if (json.status === '1' && json.result) return json.result;
      return null;
    } catch {
      return null;
    }
  }), ttlMs);
}

/**
 * Native BNB transfers for an address, newest first. Cached; returns [] on
 * upstream failure so callers can still render audit history.
 */
export async function getNormalTransactions(
  address: string,
  offset = 50,
): Promise<EtherscanNormalTx[]> {
  const result = await etherscanRequest<EtherscanNormalTx[]>(
    'account',
    'txlist',
    { address, startblock: 0, endblock: 99999999, page: 1, offset, sort: 'desc' },
    HISTORY_CACHE_TTL_MS,
  );
  return result ?? [];
}

/**
 * ERC-20 token transfers (USDT/USDC/etc.) for an address, newest first.
 */
export async function getTokenTransactions(
  address: string,
  offset = 50,
): Promise<EtherscanTokenTx[]> {
  const result = await etherscanRequest<EtherscanTokenTx[]>(
    'account',
    'tokentx',
    { address, startblock: 0, endblock: 99999999, page: 1, offset, sort: 'desc' },
    HISTORY_CACHE_TTL_MS,
  );
  return result ?? [];
}
