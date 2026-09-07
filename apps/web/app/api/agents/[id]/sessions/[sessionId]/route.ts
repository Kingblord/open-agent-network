import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { sessionManagerFactory } from '@/lib/session-manager-factory';
import { resolveAllowedContracts, resolveAllowedTokens, canonicalizeAllowedFunctions } from '@/lib/session-resolution';
import { BANError, ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.sessions.session');

/**
 * M4 - Single session lifecycle (owner-authorized).
 *
 * GET   /api/agents/:id/sessions/:sessionId           -> read a session.
 * POST  /api/agents/:id/sessions/:sessionId           -> activate | revoke.
 * PATCH /api/agents/:id/sessions/:sessionId           -> EDIT SESSION.
 *
 * PATCH body (all optional):
 *   { spendCap?, perTransactionCap?, expiresAtMs?, allowedContracts?,
 *     allowedTokens?, allowedFunctions?, riskLevel? }
 *
 * Behavior:
 *   - Owner-authorized only (agent.ownerId === user.developerId).
 *   - Allowed contracts/tokens are re-validated through the fail-closed BAN
 *     registries (unknown -> 422 CONTRACT_NOT_ALLOWED / TOKEN_NOT_ALLOWED).
 *   - If the session is ACTIVE, it is re-registered through the Altana adapter
 *     so the bounded authority updates live. If PENDING/EXPIRED/REVOKED only
 *     the stored config is updated in place.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
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
    const { id, sessionId } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    const manager = sessionManagerFactory();
    const session = await manager.getById(sessionId);
    if (!session || session.agentId !== id) {
      return errorResponse(404, 'Session not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    logger.error('session_fetch_failed', {}, err);
    return handleError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
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
    const { id, sessionId } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to manage sessions for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }
    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== 'activate' && action !== 'revoke') {
      return errorResponse(400, 'Unsupported session action; use "activate" or "revoke"', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    const manager = sessionManagerFactory();
    const session = await manager.getById(sessionId);
    if (!session || session.agentId !== id) {
      return errorResponse(404, 'Session not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const updated =
      action === 'activate' ? await manager.registerSession(sessionId) : await manager.revokeSession(sessionId);
    logger.info('session_lifecycle', { sessionId, agentId: id, action, correlationId: getCorrelationId() });
    return NextResponse.json({ ok: true, session: updated });
  } catch (err) {
    logger.error('session_lifecycle_failed', {}, err);
    return handleError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
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
    const { id, sessionId } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to edit sessions for this agent', {
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
    const b = body as Record<string, unknown>;

    const manager = sessionManagerFactory();
    const existing = await manager.getById(sessionId);
    if (!existing || existing.agentId !== id) {
      return errorResponse(404, 'Session not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // Re-validate allowed contracts/tokens through the fail-closed registries
    // ONLY when the caller actually changed them.
    let allowedContracts: string[] | undefined;
    let allowedTokens: string[] | undefined;
    let allowedFunctions: string[] | undefined;

    if (b.allowedContracts !== undefined || b.allowedProtocols !== undefined) {
      try {
        allowedContracts = resolveAllowedContracts(
          Array.isArray(b.allowedProtocols) ? (b.allowedProtocols as string[]) : [],
          Array.isArray(b.allowedContracts) ? (b.allowedContracts as string[]) : []
        );
      } catch (contractErr) {
        const message =
          contractErr instanceof BANError ? contractErr.message : 'One or more selected protocols is not verified for autonomous execution';
        return errorResponse(422, message, {
          code: ErrorCode.CONTRACT_NOT_ALLOWED,
          correlationId: getCorrelationId(),
        });
      }
    }
    if (b.allowedTokens !== undefined) {
      try {
        allowedTokens = resolveAllowedTokens(
          Array.isArray(b.allowedTokens) ? (b.allowedTokens as string[]) : [],
          Array.isArray(b.allowedTokensLegacy) ? (b.allowedTokensLegacy as string[]) : []
        );
      } catch (tokenErr) {
        const message =
          tokenErr instanceof BANError ? tokenErr.message : 'One or more selected tokens is not registered in the BAN token registry';
        return errorResponse(422, message, {
          code: ErrorCode.TOKEN_NOT_ALLOWED,
          correlationId: getCorrelationId(),
        });
      }
    }
    if (b.allowedFunctions !== undefined) {
      allowedFunctions = canonicalizeAllowedFunctions(
        Array.isArray(b.allowedFunctions)
          ? (b.allowedFunctions as string[]).map((s) => String(s).trim()).filter(Boolean)
          : (typeof b.allowedFunctions === 'string' && b.allowedFunctions ? b.allowedFunctions.split(',').map((s) => s.trim()).filter(Boolean) : [])
      );
    }

    const spendCap = typeof b.spendCap === 'string' && b.spendCap ? b.spendCap : undefined;
    const perTransactionCap = typeof b.perTransactionCap === 'string' && b.perTransactionCap ? b.perTransactionCap : undefined;
    if (spendCap && perTransactionCap && BigInt(perTransactionCap) > BigInt(spendCap)) {
      return errorResponse(422, 'perTransactionCap must not exceed spendCap', {
        code: ErrorCode.SPEND_LIMIT_EXCEEDED,
        correlationId: getCorrelationId(),
      });
    }
    const expiresAtMs = typeof b.expiresAtMs === 'number' && b.expiresAtMs > Date.now() ? b.expiresAtMs : undefined;

    const updated = await manager.updateSessionConfig(sessionId, {
      allowedContracts,
      allowedTokens,
      allowedFunctions,
      spendCap,
      perTransactionCap,
      expiresAtMs,
      riskLevel: typeof b.riskLevel === 'string' ? b.riskLevel : undefined,
    });

    logger.info('session_edited', {
      sessionId,
      agentId: id,
      correlationId: getCorrelationId(),
      status: updated.status,
      reRegistered: updated.status === 'ACTIVE',
    });

    return NextResponse.json({ ok: true, session: updated, reRegistered: updated.status === 'ACTIVE' });
  } catch (err) {
    logger.error('session_edit_failed', {}, err);
    return handleError(err);
  }
}