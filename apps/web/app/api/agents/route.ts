import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry, type AgentCreateInput } from '@/lib/agent-registry';
import { erc8004Registry, type Erc8004AgentListing } from '@ban/registry';
import { AgentStatusSchema } from '@ban/schemas';
import { ErrorCode } from '@ban/shared';
import { isErc8004LiveConfigured, syncErc8004Live } from '@/lib/erc8004-live';

const logger = createStructuredLogger('api.agents');

/**
 * M3 - Agent Registry control-plane routes.
 *
 * POST /api/agents -> create a new agent (ends in DRAFT, under the acting
 *                      developer). AUTHENTICATION-REQUIRED. The registry is the
 *                      single source of truth for the `agents` collection.
 *
 * GET  /api/agents  -> list agents, optionally scoped by owner/status.
 *                      Browsing the marketplace (Discovery, mustflow §3) is a
 *                      PUBLIC action: anyone may read the discoverable fields
 *                      of ACTIVE agents. Sign-in is only required to
 *                      hire/activate an agent, not to browse it.
 *
 *                      Unauthenticated callers receive only safe, public fields
 *                      (owner linkage, internal flags, credentials excluded).
 *                      Authenticated callers may use `?ownerId=me` (or
 *                      `?my=true`) to list THEIR OWN agents in any status —
 *                      this is what powers "My Agents" and never returns
 *                      agents owned by other developers.
 *
 *                      Marketplace merging: when browsing the PUBLIC marketplace
 *                      (no owner scope), the response includes both the
 *                      authoritative BAN agent-registry records (deduped,
 *                      ACTIVE only) AND ERC-8004 agent listings
 *                      (BAN-native + normalized external incl. LIVE
 *                      8004scan.io records when ERC8004_SCAN_API_KEY is set),
 *                      so the marketplace can show agents discovered via
 *                      ERC-8004 too. ERC-8004 listings are flagged
 *                      `source: BAN_NATIVE | EXTERNAL` and carry
 *                      `verified`/reputation-neutral fields. Discovery
 *                      does NOT grant execution authority — execution still
 *                      requires the agent to be in the BAN agent registry.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }

    const body = await request.json().catch(() => null);
    const agent = await agentRegistry.create(body as AgentCreateInput, user.developerId);

    logger.info('agent_created_via_api', { agentId: agent.id, ownerId: agent.ownerId });
    return NextResponse.json({ ok: true, agent }, { status: 201 });
  } catch (err) {
    logger.error('agent_create_failed', {}, err);
    return handleError(err);
  }
}

/** Fields safe to expose to unauthenticated marketplace browsers (mustflow §3). */
const PUBLIC_AGENT_FIELDS = [
  'id',
  'name',
  'description',
  'category',
  'type',
  'strategyId',
  'status',
  'riskLevel',
  'costPerExecution',
  'capabilities',
  'protocols',
  'allowedProtocols',
  'createdAt',
] as const;

/** Strip every field that is not explicitly public. */
function toPublicAgent(agent: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_AGENT_FIELDS) {
    if (agent[key] !== undefined && agent[key] !== null) {
      out[key] = agent[key];
    }
  }
  return out;
}

/**
 * Marketplace de-dupe: legacy duplicate registrations (same logical agent
 * seeded under different ids, e.g. `agent-lp-rebalancer` vs
 * `agent_lp_rebalancer`) must never render as two cards or double-count the
 * marketplace total. Group by (name, strategyId, type) and keep the newest
 * registration per group. Owner-scoped /api/agents?ownerId=me is NOT deduped —
 * a user may legitimately own multiple copies.
 */
function dedupeMarketplaceAgents(agents: Record<string, unknown>[]) {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const agent of agents) {
    const key = [agent.name, agent.strategyId, agent.type]
      .map((v) => String(v ?? '').toLowerCase())
      .join('::');
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || String(agent.createdAt ?? '') > String(existing.createdAt ?? '')) {
      byKey.set(key, agent);
    }
  }
  return [...byKey.values()];
}

/** Map an ERC-8004 listing into the public marketplace shape (kept source-flagged). */
function erc8004ToPublicAgent(listing: Erc8004AgentListing) {
  return {
    id: listing.id,
    name: listing.name,
    description: listing.description,
    type: listing.type,
    strategyId: listing.strategyId,
    status: listing.status === 'REGISTERED' ? 'ACTIVE' : listing.status,
    riskLevel: listing.riskLevel,
    capabilities: listing.capabilities.map((c) => ({ id: c, name: c })),
    protocols: listing.protocols,
    source: listing.source, // BAN_NATIVE | EXTERNAL
    registry: listing.registry,
    reputation: listing.reputation,
    createdAt: listing.createdAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;

    // Owner-scoping: `?ownerId=<id>`, `?ownerId=me`, and `?my=true` are all
    // supported. `me`/`my` resolve to the AUTHENTICATED user and therefore
    // require a valid token — powering "My Agents" (only agents the signed-in
    // developer actually owns).
    const ownerIdParam = request.nextUrl.searchParams.get('ownerId');
    const myParam = request.nextUrl.searchParams.get('my');
    const isSelfScope = ownerIdParam === 'me' || myParam === 'true' || myParam === '';
    const requestedOwnerId = isSelfScope ? user?.developerId : (ownerIdParam || undefined);
    if (isSelfScope && !requestedOwnerId) {
      return errorResponse(401, 'Unauthorized: sign in to list your agents', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }

    const statusRaw = request.nextUrl.searchParams.get('status') ?? undefined;
    const statusParsed = statusRaw ? AgentStatusSchema.safeParse(statusRaw) : undefined;
    const status = statusRaw && statusParsed?.success ? statusParsed.data : undefined;

    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '50') || 50;

    const agents = await agentRegistry.list({ ownerId: requestedOwnerId, status, limit });

    // Owner-scoped listing (authenticated) may see own agents in any status.
    // Public browsing (unauthenticated) shows only ACTIVE agents with public
    // fields — deduped by logical identity so legacy seed duplicates never
    // appear twice on the marketplace — and no sensitive/internal data leaks.
    if (requestedOwnerId) {
      return NextResponse.json({ ok: true, agents });
    }

    // Live ERC-8004 scan (TTL-guarded, honest fail-open; only when the API key
    // is configured). Brings external 8004scan.io agents into the marketplace.
    const liveSync = await syncErc8004Live();

    const publicAgents = dedupeMarketplaceAgents(
      agents.filter((a) => a.status === 'ACTIVE'),
    ).map(toPublicAgent);

    // ERC-8004 merge (public marketplace only): BAN-native listings that are
    // ALREADY in the registry are skipped (they'd double-render); external
    // ERC-8004 agents (incl. live-scanned) are appended so the marketplace
    // can discover them too.
    // ERC-8004 merge (public marketplace only): BAN-native listings are the
    // SAME four bots as the authoritative registry agents but under
    // ERC-8004 ids (ban-* vs agent_*) — match them by strategyId (the
    // stable bot-kind link) and skip, so we never render 8 cards for 4
    // agents. External ERC-8004 agents (incl. live-scanned) keep their
    // distinct identity and are appended unless they collide on exact id.
    const banIds = new Set(publicAgents.map((a) => String(a.id).toLowerCase()));
    const erc8004Listings = erc8004Registry.listAll()
      .filter((l) => {
        if (l.source === 'BAN_NATIVE') {
          return !publicAgents.some(
            (a) =>
              String(a.strategyId ?? '').toLowerCase() ===
              String(l.strategyId ?? '').toLowerCase(),
          );
        }
        return !banIds.has(l.id.toLowerCase());
      })
      .map(erc8004ToPublicAgent);

    const payload = [...publicAgents, ...erc8004Listings];

    logger.info('agents_listed', {
      correlationId: getCorrelationId(),
      count: payload.length,
      erc8004Count: erc8004Listings.length,
      sourceFeed: isErc8004LiveConfigured() ? 'live-8004scan' : 'registry',
    });

    return NextResponse.json({
      ok: true,
      agents: payload,
      erc8004: {
        sourceFeed: isErc8004LiveConfigured() ? 'live-8004scan' : 'registry',
        lastSyncAt: liveSync.lastSyncAt,
        count: erc8004Listings.length,
        liveError: liveSync.error ?? null,
      },
    });
  } catch (err) {
    logger.error('agents_list_failed', {}, err);
    return handleError(err);
  }
}