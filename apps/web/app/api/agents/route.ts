import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry, type AgentCreateInput } from '@/lib/agent-registry';
import { AgentStatusSchema } from '@ban/schemas';
import { ErrorCode } from '@ban/shared';

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
    // fields, so no sensitive/internal data leaks on the marketplace.
    const payload = requestedOwnerId ? agents : agents.filter((a) => a.status === 'ACTIVE').map(toPublicAgent);

    logger.info('agents_listed', { correlationId: getCorrelationId(), count: payload.length });
    return NextResponse.json({ ok: true, agents: payload });
  } catch (err) {
    logger.error('agents_list_failed', {}, err);
    return handleError(err);
  }
}