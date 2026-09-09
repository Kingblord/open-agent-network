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

// ---------------------------------------------------------------------------
// AUDIT-WRITE THROTTLE (FIRESTORE 20k/day WRITE quota — "Inngest exhausts it")
//
// The Inngest loop writes at least one audit event per cycle per agent and,
// when an executor is STUCK (e.g. the Altana "Invalid parameters" error),
// writes AGENT_EXECUTION_PENDING with the SAME note every 2 minutes — dozens
// of identical rows/hour. With 4 agents that alone can exceed the free-tier
// 20k writes/day.
//
// Policy (bounded in-memory cache, per process instance):
//   - AGENT_TICK / AGENT_EXECUTION_PENDING: the FIRST occurrence of each
//     (type, agent, note-signature) is always written; repeats are suppressed
//     for 5 minutes. A STUCK condition therefore reports once, then stays
//     quiet instead of duplicating.
//   - All other event types are ALWAYS written (state changes never lost).
// ---------------------------------------------------------------------------
const THROTTLED_TYPES = new Set(['AGENT_TICK', 'AGENT_EXECUTION_PENDING']);
const THROTTLE_WINDOW_MS = 5 * 60_000;
const throttleCache = new Map<string, number>();

function throttleSignature(
  type: string,
  agentId: string | undefined,
  detail: Record<string, unknown> | undefined,
): string {
  const note = typeof detail?.note === 'string' ? detail.note.slice(0, 120) : '';
  return `${type}|${agentId ?? ''}|${note}`;
}

function shouldThrottle(
  type: string,
  agentId: string | undefined,
  detail: Record<string, unknown> | undefined,
): boolean {
  if (!THROTTLED_TYPES.has(type)) return false;
  const key = throttleSignature(type, agentId, detail);
  const now = Date.now();
  const last = throttleCache.get(key);
  if (last && now - last < THROTTLE_WINDOW_MS) return true;
  if (throttleCache.size > 512) throttleCache.clear();
  throttleCache.set(key, now);
  return false;
}

/** TEST HOOK: export the throttle decision so regression tests can assert it
 * without hitting Firestore. Not part of the runtime API surface. */
export const __auditThrottle = {
  shouldThrottle,
  THROTTLED_TYPES,
  THROTTLE_WINDOW_MS,
  reset: () => throttleCache.clear(),
};

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
  // Throttle redundant heartbeats + repeated stuck-notes so the loop cannot
  // exhaust the Firestore write quota; first occurrence always written.
  if (shouldThrottle(input.type, input.agentId, input.detail)) {
    const throttled: AuditEvent = {
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
    return throttled; // suppressed — callers still get an event shape
  }
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
  try {
    await db.collection(collections.auditEvents).add(toFirestoreSafe(event));
  } catch (writeErr) {
    // Firestore `.add()` generates the document ID client-side; if the first
    // request landed but the response was lost (timeout/retry), a replayed
    // retry re-sends the SAME auto-ID and Firestore answers ALREADY_EXISTS.
    // The event IS persisted — treat the replay as success, never a cycle
    // failure (Rule 10: observability must not break execution).
    const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
    if (message.includes('ALREADY_EXISTS')) {
      return event; // the duplicate write IS the proof it landed
    }
    throw writeErr;
  }
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