import 'server-only';

import { getAdminDb, collections } from '@/lib/firebase-admin';
import { createStructuredLogger } from '@/lib/core/logger';
import { generateId } from '@ban/shared';
import type { Job, JobType } from '@ban/schemas';

const logger = createStructuredLogger('jobs.repo');

/**
 * M2 - Durable Job System: Firestore persistence.
 *
 * Persists job status/audit state. This is durable application state, not the
 * queue — Inngest owns dispatch/retry. A single Firestore transaction performs
 * an atomic CONFLICT-FREE claim: if the idempotency key already mapped to a
 * job, it returns created:false and leaves the existing job untouched
 * (duplicate execution protection, Rule 5 / M2 "duplicate execution
 * protection").
 *
 * The persisted field set is the full Job contract plus a `status` snapshot,
 * so the API route can serve exactly what the contract demands.
 */

function jobDataRef(db: ReturnType<typeof getAdminDb>, jobId: string) {
  return db.collection(collections.jobs).doc(jobId);
}

export async function createJobRecord(input: {
  jobType: JobType;
  agentId: string;
  userId: string;
  correlationId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}): Promise<{ created: boolean; job: Job }> {
  const db = getAdminDb();
  const jobId = generateId('job');

  const job: Job = {
    jobId,
    jobType: input.jobType,
    agentId: input.agentId,
    userId: input.userId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    attempt: 1,
    createdAt: new Date().toISOString(),
    scheduledAt: new Date(Date.now() + 1000).toISOString(),
    payload: input.payload,
  };

  const idemRef = db
    .collection(collections.jobs)
    .doc('byIdempotency')
    .collection('keys')
    .doc(input.idempotencyKey);

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(idemRef);
      if (existing.exists) return; // duplicate — no-op
      tx.set(idemRef, { jobId, jobType: input.jobType });
      tx.set(jobDataRef(db, jobId), { ...job, status: 'QUEUED' });
    });
  } catch (err) {
    logger.error('job_claim_transaction_failed', { jobId, correlationId: input.correlationId }, err);
    throw err;
  }

  return { created: true, job };
}

/** Fetch the current snapshot of a job (status, attempt, lastError). */
export async function getJobSnapshot(jobId: string) {
  const db = getAdminDb();
  const snap = await jobDataRef(db, jobId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return {
    status: data?.status ?? 'QUEUED',
    attempt: data?.attempt ?? 1,
    lastError: data?.lastError,
    updatedAt: data?.updatedAt ?? data?.createdAt,
  };
}

/** Update the status snapshot of an existing job. */
export async function updateJobStatus(
  jobId: string,
  status: string,
  extra?: { attempt?: number; lastError?: { code?: string; message?: string } }
) {
  const db = getAdminDb();
  const patch: Record<string, unknown> = { status, updatedAt: new Date().toISOString() };
  if (extra?.attempt !== undefined) patch.attempt = extra.attempt;
  if (extra?.lastError) patch.lastError = extra.lastError;
  await jobDataRef(db, jobId).update(patch);
}

// ---------------------------------------------------------------------------
// Dead-letter + audit
// ---------------------------------------------------------------------------

/** Write a dead-letter record when a job exhausts its retry budget. */
export async function writeDeadLetter(job: Job, lastError: { code?: string; message?: string }) {
  const db = getAdminDb();
  const ref = db
    .collection(collections.jobs)
    .doc(job.jobId)
    .collection('deadLetters')
    .doc(new Date().toISOString());
  await ref.set({
    jobType: job.jobType,
    agentId: job.agentId,
    userId: job.userId,
    correlationId: job.correlationId,
    idempotencyKey: job.idempotencyKey,
    error: lastError,
    deadLetteredAt: new Date().toISOString(),
  });
  logger.error('job_dead_lettered', {
    jobId: job.jobId,
    correlationId: job.correlationId,
    error: lastError,
  });
}

/** Persist an audit event for observability (Rule 10). */
export async function writeAuditEvent(entry: {
  eventType: string;
  correlationId: string;
  jobId: string;
  payload?: Record<string, unknown>;
}) {
  const db = getAdminDb();
  await db.collection(collections.auditEvents).add({
    eventId: generateId('evt'),
    eventType: entry.eventType,
    correlationId: entry.correlationId,
    jobId: entry.jobId,
    payload: entry.payload ?? {},
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Query helpers used by the control-plane GET routes.
// ---------------------------------------------------------------------------

/**
 * Fetch a single job document by ID, returning the full persisted record
 * (or null). Used by GET /api/jobs/[id].
 */
export async function getJobById(jobId: string) {
  const db = getAdminDb();
  const snap = await jobDataRef(db, jobId).get();
  if (!snap.exists) return null;
  return snap.data() as Job & { status: string };
}

/**
 * List recent job records, newest first. Optionally filter by userId so the
 * control plane can scope what a given developer sees.
 */
export async function listJobs(options: { userId?: string; limit?: number } = {}) {
  const db = getAdminDb();
  const limit = Math.min(options.limit ?? 20, 100);

  if (options.userId) {
    const snap = await db
      .collection(collections.jobs)
      .where('userId', '==', options.userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    const jobs: Array<Job & { status: string }> = [];
    snap.forEach((doc) => jobs.push(doc.data() as Job & { status: string }));
    return jobs;
  }

  const snap = await db.collection(collections.jobs).orderBy('createdAt', 'desc').limit(limit).get();
  const jobs: Array<Job & { status: string }> = [];
  snap.forEach((doc) => jobs.push(doc.data() as Job & { status: string }));
  return jobs;
}