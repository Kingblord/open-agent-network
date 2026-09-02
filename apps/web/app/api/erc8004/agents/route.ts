import { NextRequest, NextResponse } from 'next/server';
import { erc8004Registry } from '@ban/registry';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { handleError } from '@/lib/core/errors';
import { isErc8004LiveConfigured, syncErc8004Live } from '@/lib/erc8004-live';

const logger = createStructuredLogger('api.erc8004');

/**
 * GET /api/erc8004/agents
 *
 * ERC-8004 (Agent Discovery & Reputation) listing endpoint. Returns:
 *   - BAN-native agents (the four hackathon agents) registered as ERC-8004
 *     listings (source: BAN_NATIVE, verified).
 *   - External ERC-8004 records normalized into the same shape (source:
 *     EXTERNAL, verified: false, reputation neutral — never fabricated),
 *     including LIVE 8004scan.io records when ERC8004_SCAN_API_KEY is set
 *     (TTL-guarded; honest fail-open on network errors).
 *
 * Discovery-only: listing here does NOT grant execution authority. Execution
 * still requires the agent to be in the authoritative BAN agent registry.
 */
export async function GET(request: NextRequest) {
  try {
    const sourceRaw = request.nextUrl.searchParams.get('source') ?? undefined;
    const source =
      sourceRaw === 'native' ? 'native' : sourceRaw === 'external' ? 'external' : undefined;

    // Live ERC-8004 scan (TTL-guarded, fail-open) so external agents appear
    // here too, not just in the marketplace merge.
    const liveSync = await syncErc8004Live();

    const listings = source === 'native'
      ? erc8004Registry.listNative()
      : source === 'external'
        ? erc8004Registry.listExternal()
        : erc8004Registry.listAll();

    logger.info('erc8004_listed', {
      correlationId: getCorrelationId(),
      count: listings.length,
      source: source ?? 'all',
      sourceFeed: isErc8004LiveConfigured() ? 'live-8004scan' : 'registry',
    });

    return NextResponse.json({
      ok: true,
      listings,
      erc8004: {
        sourceFeed: isErc8004LiveConfigured() ? 'live-8004scan' : 'registry',
        lastSyncAt: liveSync.lastSyncAt,
        count: listings.length,
        liveError: liveSync.error ?? null,
      },
    });
  } catch (err) {
    logger.error('erc8004_list_failed', {}, err);
    return handleError(err);
  }
}