import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.developers.topup');

/**
 * Wallet top-up — honest deposit INSTRUCTION (never a fake receipt).
 *
 * POST /api/developers/topup
 * Body: { agentId: string, amountBnb: number | string }
 *
 * Validates that the caller is the owning developer and that the agent has a
 * provisioned wallet address, then returns a deterministic deposit
 * instruction (topupRequestId + agent wallet + amount + network). BAN does NOT
 * mint or invent a balance: funds are only counted once the deposit is
 * confirmed on-chain. The UI surfaces this note so the user knows exactly what
 * to send before any funds move.
 *
 * There is intentionally NO "fake success" path — if the agent has no wallet
 * yet, the caller gets a 409 telling them to provision it first.
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
    if (!body || typeof body !== 'object') {
      return errorResponse(400, 'Invalid JSON body', {
        code: ErrorCode.SCHEMA_INVALID,
        correlationId: getCorrelationId(),
      });
    }

    const b = body as Record<string, unknown>;
    const agentId = typeof b.agentId === 'string' ? b.agentId : '';
    if (!agentId) {
      return errorResponse(422, 'agentId is required', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // Parse amountBnb (number or numeric string).
    const rawAmount = b.amountBnb;
    const amount =
      typeof rawAmount === 'number' && Number.isFinite(rawAmount)
        ? rawAmount
        : typeof rawAmount === 'string' && rawAmount.trim() !== ''
          ? Number(rawAmount)
          : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse(422, 'amountBnb must be a positive number', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (amount > 1000) {
      return errorResponse(422, 'amountBnb exceeds the 1000 BNB sanity limit', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const agent = await agentRegistry.getById(agentId);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to top up this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }
    if (!agent.walletAddress) {
      return errorResponse(409, 'Agent has no provisioned wallet yet — provision it first (actions/wallet)', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const { generateId } = await import('@ban/shared');
    const topupRequestId = generateId('topup');

    logger.info('topup_request_created', {
      agentId,
      topupRequestId,
      amountBnb: amount.toFixed(6),
      actorId: user.developerId,
      correlationId: getCorrelationId(),
    });

    // Deposit instruction — NOT a receipt, NOT a balance change.
    return NextResponse.json({
      ok: true,
      topupRequestId,
      agentId,
      walletAddress: agent.walletAddress,
      amountBnb: amount.toFixed(6),
      network: 'BNB Smart Chain',
      chainId: 56,
      status: 'INSTRUCTION',
      note:
        'Send exactly the amount above to the agent wallet on BNB Smart Chain (chain 56). BAN only counts the funds after the deposit is confirmed on-chain — no balance is assumed before that.',
    });
  } catch (err) {
    logger.error('topup_request_failed', {}, err);
    return handleError(err);
  }
}