import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { JobEnqueueSchema } from '@/lib/jobs/job-common';
import { createJobRecord } from '@/lib/jobs/job-repo';
import { inngest } from '../../../inngest/client';
import { eventFor } from '../../../inngest/queues';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.jobs');

/**
 * M2 - control-plane entry point for the durable job system.
 *
 * POST  /api/jobs  -> validate + create job record + dispatch Inngest event.
 * GET   /api/jobs  -> list recent jobs (for observability in the UI).
 *
 * Requires an authenticated developer (JWT) — the control plane is trusted
 * and only this route (or an approved event producer) may enqueue.
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
    const parsed = JobEnqueueSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, 'Invalid job payload: ' + parsed.error.message, {
        code: ErrorCode.SCHEMA_INVALID,
        correlationId: getCorrelationId(),
      });
    }

    const input = parsed.data;
    const correlationId = input.correlationId || getCorrelationId();
    const idempotencyKey = input.idempotencyKey || `${input.jobType}:${input.userId}:${input.agentId}`;

    // Persist the job record first (durable state, dedupe via transaction).
    const { created, job } = await createJobRecord({
      jobType: input.jobType,
      agentId: input.agentId,
      userId: input.userId,
      correlationId,
      idempotencyKey,
      payload: input.payload,
    });

    if (!created) {
      // Duplicate — leave the existing job untouched (Rule 5).
      return errorResponse(409, 'Duplicate job: idempotency key already exists', {
        code: ErrorCode.DUPLICATE_JOB,
        correlationId,
      });
    }

    // Dispatch to Inngest (async / durable delivery).
    const event = eventFor(input.jobType);
    await inngest.send({
      name: event!,
      data: {
        jobType: input.jobType,
        jobId: job.jobId,
        agentId: job.agentId,
        userId: job.userId,
        correlationId,
        idempotencyKey,
        attempt: job.attempt,
        payload: job.payload,
      },
    });

    logger.info('job_enqueued', { jobId: job.jobId, jobType: job.jobType, correlationId, queue: event });

    return NextResponse.json(
      {
        ok: true,
        job: {
          jobId: job.jobId,
          jobType: job.jobType,
          status: 'QUEUED',
          correlationId,
          idempotencyKey,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error('job_enqueue_failed', {}, err);
    return handleError(err);
  }
}

/**
 * GET /api/jobs — list recent job records for the current dev.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }

    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '20') || 20, 100);
    const filterUser = request.nextUrl.searchParams.get('userId') || undefined;

    const { listJobs } = await import('@/lib/jobs/job-repo');
    const jobs = await listJobs({ userId: filterUser, limit });

    logger.info('jobs_listed', { correlationId: getCorrelationId(), count: jobs.length });
    return NextResponse.json({ ok: true, jobs });
  } catch (err) {
    logger.error('jobs_list_failed', {}, err);
    return handleError(err);
  }
}