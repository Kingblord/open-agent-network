import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { sessionManagerFactory } from '@/lib/session-manager-factory';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { resolveAllowedContracts, resolveAllowedTokens } from '@/lib/session-resolution';
import { BANError, ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.sessions');

/**
 * M4 - Session collection under an agent.
 *
 * POST /api/agents/:id/sessions  -> create + REGISTER a scoped session.
 * GET  /api/agents/:id/sessions  -> list sessions for an agent.
 *
 * Requires an authenticated developer, and the agent must be owned by the
 * caller. The SessionManager (via the factory) owns the session records.
 *
 * mustflow §6 (bounded authority):
 *   - The UI submits USD-denominated limits, protocol ids and token symbols.
 *   - The server RESOLVES those choices through the BAN registries
 *     (@ban/registry, fail-closed) into canonical contract/token addresses —
 *     never hardcoding addresses in the client.
 *   - After `create` the session is REGISTERED with the Altana adapter seam so
 *     it moves PENDING → ACTIVE and the bounded authority is actually live.
 *   - Unknown protocols/tokens are denied (POLICY_DENIED / TOKEN_NOT_ALLOWED).
 *
 * Registry failures (unverified/unknown contract or token) are surfaced as
 * 422 client errors with a user-facing message — never a 500. The UI greys
 * out unverified protocols, but a stale/unknown selection must still get a
 * readable error rather than a stack-trace crash.
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }
    const { id } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to create sessions for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return errorResponse(400, 'Invalid JSON body', {
        code: ErrorCode.SCHEMA_INVALID,
        correlationId: getCorrelationId(),
      });
    }

    // mustflow §6: resolve user choices through the fail-closed registries.
    let allowedContracts: string[];
    try {
      allowedContracts = resolveAllowedContracts(body.allowedProtocols, body.allowedContracts);
    } catch (contractErr) {
      // User-facing 422 with the exact protocol/token message, no stack trace.
      const message =
        contractErr instanceof BANError ? contractErr.message : 'One or more selected protocols is not verified for autonomous execution';
      return errorResponse(422, message, {
        code: ErrorCode.CONTRACT_NOT_ALLOWED,
        correlationId: getCorrelationId(),
      });
    }
    let allowedTokens: string[];
    try {
      allowedTokens = resolveAllowedTokens(body.allowedTokens, body.allowedTokensLegacy ?? []);
    } catch (tokenErr) {
      const message =
        tokenErr instanceof BANError ? tokenErr.message : 'One or more selected tokens is not registered in the BAN token registry';
      return errorResponse(422, message, {
        code: ErrorCode.TOKEN_NOT_ALLOWED,
        correlationId: getCorrelationId(),
      });
    }

    const manager = sessionManagerFactory();
    const session = await manager.create({
      agentId: id,
      walletAddress: body.walletAddress ?? agent.walletAddress ?? '',
      allowedContracts,
      allowedFunctions: body.allowedFunctions ?? [],
      allowedTokens,
      spendCap: body.spendCap ?? '0',
      perTransactionCap: body.perTransactionCap ?? '0',
      expiresAtMs: body.expiresAtMs,
    });

    // Persist the mustflow §6 risk hint on the session record (informational;
    // SessionSchema will be extended to model it explicitly in a later pass).
    if (typeof body.riskLevel === 'string') {
      const db = getAdminDb();
      await db
        .collection(collections.agentSessions)
        .doc(session.sessionId)
        .update({ riskLevel: body.riskLevel });
    }

    // mustflow §6: the bounded authority must actually become live — register
    // the session with the Altana adapter (PENDING → ACTIVE). If registration
    // fails, we return the honest PENDING session + registration:'failed' so
    // the UI surfaces it instead of claiming success.
    try {
      const registered = await manager.registerSession(session.sessionId);
      logger.info('session_created_and_registered', {
        agentId: id,
        sessionId: registered.sessionId,
        correlationId: getCorrelationId(),
      });
      return NextResponse.json({ ok: true, session: registered, registration: 'registered' }, { status: 201 });
    } catch (regErr) {
      logger.warn('session_registration_failed', {
        sessionId: session.sessionId,
        correlationId: getCorrelationId(),
        err: regErr instanceof Error ? regErr.message : String(regErr),
      });
      return NextResponse.json(
        { ok: true, session, registration: 'failed' as const },
        { status: 201 }
      );
    }
  } catch (err) {
    logger.error('session_create_failed', {}, err);
    return handleError(err);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getTokenFromRequest(_request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }
    const { id } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to list sessions for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const manager = sessionManagerFactory();
    const sessions = await manager.listByAgent(id);

    logger.info('sessions_listed', { agentId: id, count: sessions.length });
    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    logger.error('sessions_list_failed', {}, err);
    return handleError(err);
  }
}