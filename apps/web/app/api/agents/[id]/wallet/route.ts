import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { provisionAgentWallet, hasAgentKeystore } from '@/lib/altana-signer';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.wallet');

/**
 * Per-agent Altana wallet (mustflow §27–28 — one agent, one dedicated
 * wallet/address, one private-key signer stored per-agent in the keystore).
 *
 * GET  /api/agents/:id/wallet  → owner-only wallet status (address, provisioned,
 *                                keystore present). NEVER returns the private key.
 * POST /api/agents/:id/wallet  → owner-only RETRY provisioning (creates the
 *                                agent's dedicated wallet + keystore if missing).
 *
 * Keyless Altana: no API key, no relayer. SDK + signer key + funded BNB wallet
 * is the whole stack. The first execute() activates the wallet + registers its
 * admin key in Altana's Keystore.
 */
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
      return errorResponse(403, 'Not authorized to view this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const keystorePresent = await hasAgentKeystore(id);

    return NextResponse.json({
      ok: true,
      agentId: id,
      walletAddress: agent.walletAddress ?? null,
      provisioned: Boolean(agent.walletAddress) && keystorePresent,
      keystorePresent,
      // The private key is NEVER returned.
    });
  } catch (err) {
    logger.error('wallet_status_failed', {}, err);
    return handleError(err);
  }
}

export async function POST(
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
      return errorResponse(403, 'Not authorized to manage this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    // Idempotent: if already provisioned, return the existing wallet.
    const existingKeystore = await hasAgentKeystore(id);
    if (existingKeystore && agent.walletAddress) {
      return NextResponse.json({
        ok: true,
        agentId: id,
        walletAddress: agent.walletAddress,
        provisioned: true,
        alreadyProvisioned: true,
      });
    }

    let walletStatus: 'provisioned' | 'provision_failed' = 'provision_failed';
    let walletAddress: string | null = null;
    try {
      const provisioned = await provisionAgentWallet(id);
      walletAddress = provisioned.walletAddress;
      await agentRegistry.bindWallet(id, provisioned.walletAddress, user.developerId);
      walletStatus = 'provisioned';
      logger.info('agent_wallet_provisioned_via_api', {
        agentId: id,
        actorId: user.developerId,
      });
    } catch (err) {
      logger.warn('agent_wallet_provision_failed', {
        agentId: id,
        actorId: user.developerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json(
      {
        ok: walletStatus === 'provisioned',
        agentId: id,
        walletAddress,
        provisioned: walletStatus === 'provisioned',
        walletStatus,
      },
      { status: walletStatus === 'provisioned' ? 200 : 502 }
    );
  } catch (err) {
    logger.error('agent_wallet_provision_failed', {}, err);
    return handleError(err);
  }
}