import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { getJobById } from '@/lib/jobs/job-repo';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.jobs');

/**
 * M2 - GET /api/jobs/[id] -> fetch a single job's persisted state.
 *
 * Demonstrates the durable-job loop visibly: after POST /api/jobs enqueues,
 * the worker flips the same document QUEUED -> RUNNING -> SUCCEEDED/DEAD_LETTER,
 * and this route lets a client poll that exact record until it settles.
 *
 * Requires an authenticated developer (control plane is trusted).
 */
export async function GET(
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

    const job = await getJobById(id);
    if (!job) {
      return errorResponse(404, 'Job not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    logger.info('job_fetched', {
      jobId: job.jobId,
      jobType: job.jobType,
      status: job.status,
      correlationId: job.correlationId,
    });

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    logger.error('job_fetch_failed', {}, err);
    return handleError(err);
  }
}