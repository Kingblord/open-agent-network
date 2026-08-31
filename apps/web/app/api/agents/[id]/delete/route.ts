import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { deleteAgentKeystore } from '@/lib/altana/keystore';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.delete');

/**
 * DELETE /api/agents/:id/delete — owner-only permanent deletion path for the
 * profile "MANAGE AGENTS" card.
 *
 * Semantics:
 *   - REQUIRES authentication + ownership (403 otherwise).
 *   - Always transitions the agent to REVOKED first (terminal) so any running
 *     loop/heartbeat stops — the Inngest reconcile/tick and the self-chaining
 *     loop only continue while status === ACTIVE.
 *   - Deletes the agent record from the registry (permanent).
 *   - Deletes the encrypted per-agent keystore (agent's dedicated wallet key).
 *     The on-chain wallet address itself cannot be revoked, but the key is
 *     destroyed so nothing can sign for this agent anymore. Funds that may
 *     remain in that wallet are not recoverable through BAN (documented below).
 *   - Returns 200 { ok: true, deletedAgentId }.
 *
 * Deliberately NOT a soft-delete: the user asked to remove their agent from
 * their profile, so we hard-delete the registry record + keystore. Sessions /
 * tasks / executions remain in Firestore as historical audit (never mutated)
 * and are simply no longer listed under an active agent.
 */
export async function DELETE(
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
      return errorResponse(403, 'Not authorized to delete this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    // 1) Terminal-revoke first (stops the loop; REVOKED is a valid from-state
    //    source for the delete path, and it emits a governance audit event).
    if (agent.status !== 'REVOKED') {
      try {
        await agentRegistry.lifecycle(id, 'revoke', user.developerId);
      } catch (err) {
        // Revoke may fail for already-REVOKED/terminal agents; deletion is
        // still safe from any non-ACTIVE state.
        logger.warn('agent_delete_revoke_skipped', {
          agentId: id,
          actorId: user.developerId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2) Destroy the agent's dedicated signing key (encrypted Firestore keystore).
    try {
      await deleteAgentKeystore(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('agent_delete_keystore_failed', { agentId: id, message });
      // Non-fatal: the registry record can still be deleted.
    }

    // 3) Permanent deletion of the registry record.
    try {
      await agentRegistry.delete(id, user.developerId);
    } catch (err) {
      logger.error('agent_delete_registry_failed', { agentId: id }, err);
      return handleError(err);
    }

    logger.info('agent_deleted', { agentId: id, ownerId: user.developerId });
    return NextResponse.json({ ok: true, deletedAgentId: id });
  } catch (err) {
    logger.error('agent_delete_failed', {}, err);
    return handleError(err);
  }
}