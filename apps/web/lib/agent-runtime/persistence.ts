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
 *
 * Firestore safety: optional fields are often `undefined` on audit events /
 * records (e.g. `proposalId` on `AGENT_OBSERVED`). Firestore REJECTS documents
 * that contain `undefined` values with "Cannot use 'undefined' as a Firestore
 * value". Every write in this module passes through `toFirestoreSafe()`, which
 * recursively drops `undefined` keys so a missing optional field can never
 * crash a cycle (this was the cause of `cycle_error:ERR_INTERNAL` on a
 * successful observe — the audit write failed, not the observation).
 */

/** Recursively remove `undefined` values so Firestore accepts the document. */
export function toFirestoreSafe<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => toFirestoreSafe(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = toFirestoreSafe(v);
    }
    return out as T;
  }
  return value;
}

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
  await db.collection(collections.auditEvents).add(toFirestoreSafe(event));
  return event;
}

/** Persist an execution record (M8). Only a real execution state. */
export async function persistExecution(execution: Execution): Promise<void> {
  const db = getAdminDb();
  await db
    .collection(collections.executions)
    .doc(execution.executionId)
    .set(toFirestoreSafe(execution));
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
  await db
    .collection(collections.positions)
    .doc(position.positionId)
    .set(toFirestoreSafe(position));
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
  await db
    .collection(collections.performance)
    .doc(performance.performanceId)
    .set(toFirestoreSafe(performance));
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

/** Persist grid strategy state to Firestore (survives serverless cycles). */
export async function persistGridState(agentId: string, state: Record<string, unknown>): Promise<void> {
  const db = getAdminDb();
  await db
    .collection(collections.agentTasks ?? 'agent_tasks')
    .doc(agentId)
    .collection('grid_state')
    .doc('current')
    .set(toFirestoreSafe(state));
}

/** Load persisted grid strategy state from Firestore. Returns null when no state exists. */
export async function loadGridState(agentId: string): Promise<Record<string, unknown> | null> {
  const db = getAdminDb();
  const snap = await db
    .collection(collections.agentTasks ?? 'agent_tasks')
    .doc(agentId)
    .collection('grid_state')
    .doc('current')
    .get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}