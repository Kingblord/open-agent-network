import 'server-only';

/**
 * Live ERC-8004 scan integration (8004scan.io).
 *
 * Fetches `https://8004scan.io/api/v1/agents` with `X-API-Key:
 * ERC8004_SCAN_API_KEY` and normalizes external agent records into the shared
 * `@ban/registry` Erc8004Registry via `normalizeExternalErc8004Record`.
 *
 * Honest fail-open contract (update-v3 §4, "no fabricated data"):
 *   - If the API key is not set, we return `synced: false` (no external data).
 *   - If the fetch fails / is unreachable, we log and return `synced: false`
 *     with `error` — the marketplace falls back to BAN-native + already-known
 *     listings; we NEVER synthesize agents or reputation.
 *   - Records are registered with `verified: false` + reputation-neutral
 *     (the registry's spoof-protection keeps BAN-native ids authoritative).
 *   - 60s in-memory TTL so route handlers don't hammer the third-party API.
 */

import { createStructuredLogger } from '@/lib/core/logger';
import { erc8004Registry, normalizeExternalErc8004Record } from '@ban/registry';

const logger = createStructuredLogger('erc8004-live');

const ERC8004_SCAN_URL = 'https://8004scan.io/api/v1/agents' as const;
/** 60s: fast enough for a demo, slow enough to not throttle the scan API. */
const SYNC_TTL_MS = 60_000;

let syncCache: { at: number; count: number } | null = null;

export function isErc8004LiveConfigured(): boolean {
  return Boolean(process.env.ERC8004_SCAN_API_KEY || process.env['8004SCAN_API_KEY']);
}

function apiKey(): string {
  return process.env.ERC8004_SCAN_API_KEY || process.env['8004SCAN_API_KEY'] || '';
}

export interface Erc8004SyncResult {
  synced: boolean;
  count: number;
  lastSyncAt: string | null;
  error?: string;
}

/**
 * Fetch + ingest live ERC-8004 listings (TTL-guarded, fail-open).
 * Safe to call from any route handler; never throws.
 */
export async function syncErc8004Live(): Promise<Erc8004SyncResult> {
  if (!isErc8004LiveConfigured()) {
    return { synced: false, count: 0, lastSyncAt: null };
  }

  const now = Date.now();
  if (syncCache && now - syncCache.at < SYNC_TTL_MS) {
    return { synced: true, count: syncCache.count, lastSyncAt: new Date(syncCache.at).toISOString() };
  }

  try {
    const res = await fetch(ERC8004_SCAN_URL, {
      headers: { 'X-API-Key': apiKey(), Accept: 'application/json' },
      cache: 'no-store',
    } as RequestInit);

    if (!res.ok) {
      throw new Error(`8004scan returned HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as unknown;
    const rawRecords = Array.isArray(data)
      ? (data as unknown[])
      : Array.isArray((data as { agents?: unknown[] })?.agents)
        ? (data as { agents: unknown[] }).agents
        : [];

    const listings = rawRecords.map((record, i) =>
      normalizeExternalErc8004Record(
        record as Parameters<typeof normalizeExternalErc8004Record>[0],
        i,
      ),
    );

    // Registry-level spoof-protection: BAN-native ids always win; externals
    // with a colliding id are dropped (Erc8004Registry.register handles this).
    for (const listing of listings) {
      erc8004Registry.register(listing);
    }

    syncCache = { at: now, count: listings.length };
    logger.info('erc8004-live-synced', { count: listings.length, at: now });
    return { synced: true, count: listings.length, lastSyncAt: new Date(now).toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('erc8004-live-failed', { message });
    return { synced: false, count: 0, lastSyncAt: syncCache ? new Date(syncCache.at).toISOString() : null, error: message };
  }
}