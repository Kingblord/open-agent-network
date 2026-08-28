/* eslint-disable @typescript-eslint/no-unused-vars */
import 'server-only';

import { getAdminDb, collections } from '@/lib/firebase-admin';
import { generateId } from '@ban/shared';
import type { AuditEvent, Execution, Position, Performance } from '@ban/schemas';

/**
 * BAN Agent Runtime — persistence seams (Batch C).
 *
 * Writes the observable output of a closed-loop cycle into the Firebase
 * collections the control-plane API already reads:
 *   - audit_events  (drives /activity and /api/agents/:id/activity)
 *   - executions    (drives /performance confirmed exec count)
 *   - positions     (drives position/holdings data when confirmed)
 *   - performance   (drives performance metrics)
 *
 * Every write is additive and only records what actually happened. Nothing here
 * fabricates a transaction, a position, or a performance figure.
 */

export function auditEventType(value: string): AuditEvent['type'] {
  return value as AuditEvent['type'];
}

/** Persist a structured audit event to `audit_events` (Rule 10 / observability). */
export async function persistAuditEvent(input: {
  type: string;
  severity?: AuditEvent['severity'];
  correlationId?: string;
  agentId?: string;
  userId?: string;
  proposalId?: string;
  sessionId?: string;
  executionId?: string;
  detail?: Record<string, unknown>;
}): Promise<AuditEvent> {
  const db = getAdminDb();
  const event: AuditEvent = {
    eventId: generateId('evt'),
    type: auditEventType(input.type),
    severity: input.severity ?? 'INFO',
    correlationId: input.correlationId,
    agentId: input.agentId,
    userId: input.userId,
    proposalId: input.proposalId,
    sessionId: input.sessionId,
    executionId: input.executionId,
    detail: input.detail ?? {},
    createdAt: new Date().toISOString(),
  };
  await db.collection(collections.auditEvents).add(event);
  return event;
}

/** Persist an execution record (M8). Only a real execution state. */
export async function persistExecution(execution: Execution): Promise<void> {
  const db = getAdminDb();
  await db.collection(collections.executions).doc(execution.executionId).set(execution);
}

/** Fetch an execution by id (for idempotency / reconcile). */
export async function getExecutionById(executionId: string): Promise<Execution | null> {
  const db = getAdminDb();
  const snap = await db.collection(collections.executions).doc(executionId).get();
  return snap.exists ? (snap.data() as Execution) : null;
}

/** Persist a position only when a confirmed execution produced it (never a fabricated one). */
export async function upsertPosition(position: Position): Promise<void> {
  const db = getAdminDb();
  await db.collection(collections.positions).doc(position.positionId).set(position);
}

export async function listPositions(agentId: string): Promise<Position[]> {
  const db = getAdminDb();
  const snap = await db.collection(collections.positions).where('agentId', '==', agentId).get();
  const out: Position[] = [];
  snap.forEach((d) => out.push(d.data() as Position));
  return out;
}

/** Persist a performance rollup. */
export async function upsertPerformance(performance: Performance): Promise<void> {
  const db = getAdminDb();
  await db.collection(collections.performance).doc(performance.performanceId).set(performance);
}

export async function getPerformanceByAgent(agentId: string): Promise<Performance | null> {
  const db = getAdminDb();
  const snap = await db.collection(collections.performance).where('agentId', '==', agentId).get();
  let found: Performance | null = null;
  snap.forEach((d) => {
    if (!found) found = d.data() as Performance;
  });
  return found;
}