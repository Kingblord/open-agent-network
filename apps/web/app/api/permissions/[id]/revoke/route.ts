import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import {
  getPermission,
  revokePermission,
} from '@/lib/permissions/permission-repo';
import { persistAuditEvent } from '@/lib/agent-runtime/persistence';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.permissions.revoke');

/**
 * POST /api/permissions/[id]/revoke
 *
 * Terminal, one-shot revocation of an EIP-7702 permission (update-v3 §11):
 * only the permission OWNER may revoke; once REVOKED the record cannot be
 * re-activated; all subsequent run-cycle gates fail closed
 * (PermissionResolver requires ACTIVE). An audit event is persisted so the
 * revocation is attributable.
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
    if (permission.status === 'REVOKED') {
      return errorResponse(409, 'Permission already revoked (terminal)', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const revoked = await revokePermission(permission.id);
    if (!revoked) {
      return errorResponse(500, 'Permission revocation failed', {
        code: ErrorCode.INTERNAL,
        correlationId: getCorrelationId(),
      });
    }

    await persistAuditEvent({
      type: 'PERMISSION_REVOKED',
      correlationId: getCorrelationId(),
      agentId: permission.agentId,
      userId: user.developerId,
      detail: {
        permissionId: permission.id,
        userAddress: permission.userAddress,
        jobId: permission.jobId,
        status: 'REVOKED',
      },
    });

    logger.info('permission_revoked', {
      permissionId: permission.id,
      agentId: permission.agentId,
      jobId: permission.jobId,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({ ok: true, permission: revoked });
  } catch (err) {
    logger.error('permission_revoke_failed', {}, err);
    return handleError(err);
  }
}