import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import {
  createPermission,
  listPermissionsByAgent,
  type CreatePermissionInput,
} from '@/lib/permissions/permission-repo';
import { agentRegistry } from '@/lib/agent-registry';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.permissions');

/**
 * EIP-7702 permission control-plane (update-v3 §8–§11, Option A).
 *
 * POST /api/permissions  — create a PENDING permission profile (auth'd).
 *   Body: { agentId, userAddress, jobId?, capabilities[], allowedProtocols[],
 *          allowedContracts[], allowedFunctions[], allowedTokens[],
 *          spendCap, perTransactionCap, asset?, validAfter, validUntil }
 *   Guards: caller must be signed in; agent must EXIST + be ACTIVE in the
 *   authoritative BAN agent registry (ERC-8004 discovery lists do NOT grant
 *   execution authority). The permission starts PENDING — nothing is executed
 *   until the user's EIP-7702 signature is verified server-side (activate route).
 *
 * GET /api/permissions?agentId=  — list the CALLER'S OWN permissions for an
 *   agent (owner-scoped; never another user's records), optional ?status=.
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
      return errorResponse(400, 'Invalid request body', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const agentId = String(body.agentId ?? '').trim();
    if (!agentId) {
      return errorResponse(400, 'agentId is required', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // Execution authority only comes from the authoritative registry.
    const agent = await agentRegistry.getById(agentId);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.status !== 'ACTIVE') {
      return errorResponse(409, `Agent is ${agent.status}; only ACTIVE agents can be authorized to act on user funds`, {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const userAddress = String(body.userAddress ?? '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return errorResponse(400, 'userAddress must be a valid EVM address', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const strArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(String) : [];

    const spendCap = String(body.spendCap ?? '');
    const perTransactionCap = String(body.perTransactionCap ?? '');
    try {
      if (spendCap === '' || BigInt(spendCap) < 0n) throw new Error('invalid spendCap');
      if (perTransactionCap === '' || BigInt(perTransactionCap) < 0n) throw new Error('invalid perTransactionCap');
    } catch {
      return errorResponse(400, 'spendCap and perTransactionCap must be non-negative integer (wei decimal) strings', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const validAfter = String(body.validAfter ?? '');
    const validUntil = String(body.validUntil ?? '');
    if (!validAfter || !validUntil || new Date(validUntil).getTime() <= new Date(validAfter).getTime()) {
      return errorResponse(400, 'validAfter/validUntil must be ISO-8601 with validUntil > validAfter', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const input: CreatePermissionInput = {
      agentId: agent.id,
      userId: user.developerId,
      userAddress,
      jobId: body.jobId ? String(body.jobId) : undefined,
      capabilities: strArray(body.capabilities),
      allowedProtocols: strArray(body.allowedProtocols),
      allowedContracts: strArray(body.allowedContracts),
      allowedFunctions: strArray(body.allowedFunctions),
      allowedTokens: strArray(body.allowedTokens),
      spendCap,
      perTransactionCap,
      asset: body.asset ? String(body.asset) : undefined,
      validAfter,
      validUntil,
    };

    const permission = await createPermission(input);
    logger.info('permission_created', {
      permissionId: permission.id,
      agentId: agent.id,
      userId: user.developerId,
      requiresUserFunds: Boolean(body.requiresUserFunds),
      correlationId: getCorrelationId(),
    });
    return NextResponse.json({ ok: true, permission }, { status: 201 });
  } catch (err) {
    logger.error('permission_create_failed', {}, err);
    return handleError(err);
  }
}

/** List the CALLER'S OWN permission records for an agent (owner-scoped). */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }

    const agentId = request.nextUrl.searchParams.get('agentId') ?? undefined;
    if (!agentId) {
      return errorResponse(400, 'agentId query param is required', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const statusRaw = request.nextUrl.searchParams.get('status') ?? undefined;
    const status =
      statusRaw === 'PENDING' || statusRaw === 'ACTIVE' || statusRaw === 'REVOKED' || statusRaw === 'EXPIRED'
        ? statusRaw
        : undefined;

    const all = await listPermissionsByAgent(agentId, status);
    // Never leak another user's records — owner-scope on the caller's id.
    const owned = all.filter((p) => p.userId === user.developerId);
    return NextResponse.json({ ok: true, permissions: owned });
  } catch (err) {
    logger.error('permission_list_failed', {}, err);
    return handleError(err);
  }
}