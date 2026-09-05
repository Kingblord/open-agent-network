import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import {
  getPermission,
  activatePermission,
} from '@/lib/permissions/permission-repo';
import { verifyAuthorizationForPermission } from '@ban/eip7702';
import { persistAuditEvent } from '@/lib/agent-runtime/persistence';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.permissions.activate');

/**
 * POST /api/permissions/[id]/activate
 *
 * One-time EIP-7702 activation: the user signs the authorization tuple
 * (chain 56, BAN permission impl, EOA nonce) in their wallet; this route
 * receives { authorization, signature } and verifies it SERVER-SIDE before
 * the PENDING permission becomes ACTIVE:
 *
 *   - recovered signer must equal permission.userAddress (the user EOA),
 *   - authorization.chainId must equal BAN_MAINNET_CHAIN_ID (56),
 *   - authorization nonce must equal the permission's replay-guard nonce,
 *   - the permission must currently be PENDING (no double-activate),
 *   - the caller must be the permission's owner (userId match).
 *
 * Nothing executes until this succeeds. Any mismatch → 409 POLICY_DENIED and
 * the permission stays PENDING. On success the transition + a full audit event
 * are persisted (update-v3 §11).
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
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

    const { id } = await ctx.params;
    const permission = await getPermission(id);
    if (!permission) {
      return errorResponse(404, 'Permission not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (permission.userId !== user.developerId) {
      return errorResponse(403, 'Not your permission', {
        code: ErrorCode.FORBIDDEN,
        correlationId: getCorrelationId(),
      });
    }

    const body = await request.json().catch(() => null);
    const authorization = body?.authorization;
    const signature = body?.signature;
    if (!authorization || typeof signature !== 'string') {
      return errorResponse(400, 'authorization + signature are required', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // Fail-closed: only a PENDING permission can be activated once.
    if (permission.status !== 'PENDING') {
      return errorResponse(409, `Permission is ${permission.status}; only PENDING can be activated`, {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    // Server-side EIP-7702 verification (recover signer == userAddress;
    // chain 56; nonce == permission.nonce). Throws EIP7702Error on mismatch.
    await verifyAuthorizationForPermission({
      auth: authorization,
      signature,
      permission,
      chainId: 56, // BAN mainnet — never silently anything else
    });

    const activated = await activatePermission(permission.id);
    if (!activated) {
      return errorResponse(500, 'Permission activation failed', {
        code: ErrorCode.INTERNAL,
        correlationId: getCorrelationId(),
      });
    }

    await persistAuditEvent({
      type: 'PERMISSION_ACTIVATED',
      correlationId: getCorrelationId(),
      agentId: permission.agentId,
      userId: user.developerId,
      detail: {
        permissionId: permission.id,
        userAddress: permission.userAddress,
        jobId: permission.jobId,
        status: 'ACTIVE',
      },
    });

    logger.info('permission_activated', {
      permissionId: permission.id,
      agentId: permission.agentId,
      jobId: permission.jobId,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({ ok: true, permission: activated });
  } catch (err) {
    logger.error('permission_activate_failed', {}, err);
    return handleError(err);
  }
}