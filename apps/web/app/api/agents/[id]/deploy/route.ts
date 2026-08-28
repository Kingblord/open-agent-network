import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { provisionAgentWallet } from '@/lib/altana-signer';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.deploy');

/**
 * M3/M9 - Copy-on-deploy: hire a canonical marketplace agent template.
 *
 * POST /api/agents/:id/deploy -> AUTHENTICATED. Creates a user-owned clone of
 *                                the canonical (marketplace) agent and assigns
 *                                it to the acting developer.
 *
 * The canonical agent (ownerId = 'ban-smart-money') is a public product shared
 * by the marketplace. Deploying does NOT mutate it: it creates a NEW agent
 * record owned by the caller, in DRAFT state, ready to be activated/sessioned.
 * This is what makes it show up under "My Agents" (?my=true / ownerId=me) and
 * guarantees the user only ever sees agents that are actually theirs.
 *
 * Per-agent wallet (Option A, mustflow §27-28):
 *   - After the copy, this route PROVISIONS the agent's OWN Altana wallet
 *     (dedicated private-key signer stored in the agent keystore — never in
 *     Firestore, never returned). The derived walletAddress is bound to the
 *     agent via registry.bindWallet so activation readiness can be satisfied.
 *   - walletStatus: 'provisioned' | 'provision_failed' | 'unavailable' is
 *     returned (the private key is NEVER exposed).
 *
 * Semantics (Option A — copy-on-deploy):
 *   - Template stays immutable & discoverable on the marketplace.
 *   - The caller receives their own agent instance with ownerId = developerId.
 *   - No fabricated values are written; activation still requires a real
 *     lifecycle + session path.
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
    const actorId = user.developerId;

    const { id } = await params;
    const template = await agentRegistry.getById(id);
    if (!template) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // If the caller deploys an agent they already own, don't create a duplicate —
    // just return the existing (idempotency for the UI/button).
    let agent = template.ownerId === actorId ? template : null;
    if (!agent) {
      agent = await agentRegistry.create(
        {
          name: template.name,
          description: template.description,
          type: template.type,
          strategyId: template.strategyId,
          riskLevel: template.riskLevel,
          capabilities: template.capabilities,
          protocols: template.protocols,
        } as never,
        actorId
      );
      logger.info('agent_deployed_copy', {
        templateId: id,
        newAgentId: agent.id,
        ownerId: actorId,
        correlationId: getCorrelationId(),
      });
    }

    // Per-agent wallet provision (dedicated address + key per deployed agent).
    // Best-effort: if it fails (e.g. SDK not installed / network), the agent is
    // still created but walletStatus is honest; provisioning can be retried via
    // the wallet route.
    let walletStatus: 'provisioned' | 'provision_failed' | 'unavailable' = 'unavailable';
    let walletAddress: string | undefined = agent.walletAddress ?? undefined;
    try {
      const provisioned = await provisionAgentWallet(agent.id);
      walletAddress = provisioned.walletAddress;
      await agentRegistry.bindWallet(agent.id, provisioned.walletAddress, actorId);
      walletStatus = 'provisioned';
      agent = { ...agent, walletAddress: provisioned.walletAddress };
    } catch (err) {
      walletStatus = 'provision_failed';
      logger.warn('agent_wallet_provision_failed', {
        agentId: agent.id,
        ownerId: actorId,
        error: err instanceof Error ? err.message : String(err),
        correlationId: getCorrelationId(),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        agent,
        deployed: true,
        alreadyOwned: template.ownerId === actorId,
        walletStatus,
        walletAddress, // derived address only — never the private key
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error('agent_deploy_failed', {}, err);
    return handleError(err);
  }
}