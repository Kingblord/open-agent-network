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
import { verifyAuthorizationForPermission, computeAuthority, permissionConfigHash } from '@ban/eip7702';
import { contractActivate } from '@/lib/eip7702-contract-client';
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

    // Best-effort on-chain activation call. The Firestore record is the
    // source of truth; the on-chain permission is an additional guard that
    // works when BSC activates EIP-7702 delegation. A non-critical failure
    // here does NOT roll back the Firestore activation.
    const configHash = permissionConfigHash(permission);
    const authority = computeAuthority({
      userAddress: permission.userAddress ?? '',
      agentId: permission.agentId,
      configHash,
    });
    const validAfter = permission.validAfter
      ? Math.floor(new Date(permission.validAfter).getTime() / 1000)
      : 0;
    const validUntil = permission.validUntil
      ? Math.floor(new Date(permission.validUntil).getTime() / 1000)
      : 0;
    const spendLimit = BigInt(permission.spend?.spendLimit ?? '0');
    const perTxCap = BigInt(permission.spend?.perTransactionCap ?? '0');
    const agentExecutor = process.env.NEXT_PUBLIC_BAN_EXECUTOR_ADDRESS?.trim() as `0x${string}` | undefined;
    const calls = (permission.allowedContracts ?? []).length > 0
      ? permission.allowedContracts.map((c) => ({ target: c as `0x${string}`, selector: '0x00000000' as `0x${string}` }))
      : [];
    const tokens = (permission.allowedTokens ?? []).length > 0
      ? permission.allowedTokens.map((t) => ({ token: t as `0x${string}` }))
      : [];

    const onchainResult = await contractActivate({
      authority: authority as `0x${string}`,
      user: (permission.userAddress ?? '') as `0x${string}`,
      agentExecutor: agentExecutor ?? (permission.userAddress as `0x${string}`),
      spendLimit,
      perTxCap,
      validAfter,
      validUntil,
      calls,
      tokens,
    }).catch((err) => {
      logger.warn('contract_activate_best_effort_failed', {
        permissionId: permission.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

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
        onchainTxHash: onchainResult?.txHash ?? null,
      },
    });

    logger.info('permission_activated', {
      permissionId: permission.id,
      agentId: permission.agentId,
      jobId: permission.jobId,
      onchainTxHash: onchainResult?.txHash ?? null,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({ ok: true, permission: activated, onchainTxHash: onchainResult?.txHash ?? null });
  } catch (err) {
    logger.error('permission_activate_failed', {}, err);
    return handleError(err);
  }
}