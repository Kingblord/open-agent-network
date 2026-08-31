import 'server-only';

/**
 * TASKS — the durable, user-visible unit of agent work (replaces the blunt
 * "Activate Agent" button with an explicit "Create Task" flow).
 *
 * POST /api/agents/:id/tasks  -> create a task + create/register the scoped
 *                                session (same bounded authority as the
 *                                sessions route), activate the agent, and run
 *                                one closed-loop cycle immediately.
 * GET  /api/agents/:id/tasks  -> list tasks for an agent (newest first).
 *
 * The task config captures EVERY config the backend consumes:
 *   - network (BNB Smart Chain, chain 56 — the BAN execution chain)
 *   - USD-denominated limits (max tx, daily) -> converted to wei via a live
 *     BNB/USD price (the same mustflow §6 path the sessions modal uses)
 *   - allowed tokens / protocols / functions (resolved fail-closed via
 *     @ban/registry into canonical addresses)
 *   - risk level (informational, recorded on the session)
 *   - expiry (days -> ms)
 *
 * A task is persisted in Firestore (`agent_tasks`) with its full resolved
 * config so the UI can show exactly what the backend runs with. It never
 * fabricates execution results: the immediate run's honest CycleResult is
 * returned as `initialRun` and also recorded as an audit event.
 *
 * Firestore safety: Firestore REJECTS `undefined` as a field value. The cycle
 * result is therefore sanitized with stripUndefined before it is embedded in
 * `lastRun.result` — an honest `{ ok: true, stage: 'awaited' }` (no reason /
 * no executionId) and an honest `{ ok: false, reason, code }` must both
 * persist without throwing "Cannot use undefined as a Firestore value".
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { sessionManagerFactory } from '@/lib/session-manager-factory';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { resolveAllowedContracts, resolveAllowedTokens } from '@/lib/session-resolution';
import { runAgentCycle } from '@/lib/agent-runtime/run-cycle';
import { BANError, ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.tasks');

export interface TaskRecord {
  taskId: string;
  agentId: string;
  ownerId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  config: {
    network: string;
    chainId: number;
    maxTxUsd: string;
    dailyLimitUsd: string;
    maxTxWei: string;
    dailyWei: string;
    allowedTokens: string[];
    allowedProtocols: string[];
    allowedFunctions: string[];
    riskLevel: string;
    expiresAtMs: number;
  };
  sessionId: string | null;
  lastRun: {
    at: string;
    result: Record<string, unknown>;
  } | null;
  createdAt: string;
  updatedAt: string;
}

const TASK_STATUS = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] as const;

/** Recursively remove undefined values so the object is Firestore-safe. */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

async function createTaskRecord(agentId: string, ownerId: string, config: TaskRecord['config'], sessionId: string | null, runResult: Record<string, unknown> | null): Promise<TaskRecord> {
  const db = getAdminDb();
  const { generateId } = await import('@ban/shared');
  const taskId = generateId('task');
  const now = new Date().toISOString();
  const record: TaskRecord = {
    taskId,
    agentId,
    ownerId,
    status: runResult?.ok === false ? 'FAILED' : 'COMPLETED',
    config,
    sessionId,
    lastRun: runResult ? { at: now, result: stripUndefined(runResult) as Record<string, unknown> } : null,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(collections.agentTasks ?? 'agent_tasks').doc(taskId).set(stripUndefined(record) as TaskRecord);
  return record;
}

export async function POST(
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
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to create tasks for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return errorResponse(400, 'Invalid JSON body', {
        code: ErrorCode.SCHEMA_INVALID,
        correlationId: getCorrelationId(),
      });
    }

    const b = body as Record<string, unknown>;
    const maxTxUsd = typeof b.maxTxUsd === 'string' && b.maxTxUsd ? b.maxTxUsd : '0';
    const dailyLimitUsd = typeof b.dailyLimitUsd === 'string' && b.dailyLimitUsd ? b.dailyLimitUsd : '0';
    const maxTxWei = typeof b.maxTxWei === 'string' && b.maxTxWei ? b.maxTxWei : '0';
    const dailyWei = typeof b.dailyWei === 'string' && b.dailyWei ? b.dailyWei : '0';

    // Resolve through the fail-closed registries (same path as sessions).
    let allowedContracts: string[];
    try {
      allowedContracts = resolveAllowedContracts(
        Array.isArray(b.allowedProtocols) ? (b.allowedProtocols as string[]) : [],
        Array.isArray(b.allowedContracts) ? (b.allowedContracts as string[]) : []
      );
    } catch (contractErr) {
      const message =
        contractErr instanceof BANError ? contractErr.message : 'One or more selected protocols is not verified for autonomous execution';
      return errorResponse(422, message, {
        code: ErrorCode.CONTRACT_NOT_ALLOWED,
        correlationId: getCorrelationId(),
      });
    }
    let allowedTokens: string[];
    try {
      allowedTokens = resolveAllowedTokens(
        Array.isArray(b.allowedTokens) ? (b.allowedTokens as string[]) : [],
        Array.isArray(b.allowedTokensLegacy) ? (b.allowedTokensLegacy as string[]) : []
      );
    } catch (tokenErr) {
      const message =
        tokenErr instanceof BANError ? tokenErr.message : 'One or more selected tokens is not registered in the BAN token registry';
      return errorResponse(422, message, {
        code: ErrorCode.TOKEN_NOT_ALLOWED,
        correlationId: getCorrelationId(),
      });
    }

    const allowedFunctions = Array.isArray(b.allowedFunctions)
      ? (b.allowedFunctions as string[]).map((s) => String(s).trim()).filter(Boolean)
      : (typeof b.allowedFunctions === 'string' && b.allowedFunctions ? b.allowedFunctions.split(',').map((s) => s.trim()).filter(Boolean) : []);
    const riskLevel = typeof b.riskLevel === 'string' ? b.riskLevel : 'LOW';
    const expiresAtMs = typeof b.expiresAtMs === 'number' && b.expiresAtMs > Date.now() ? b.expiresAtMs : Date.now() + 30 * 24 * 60 * 60 * 1000;

    const manager = sessionManagerFactory();
    const session = await manager.create({
      agentId: id,
      walletAddress: agent.walletAddress ?? '',
      allowedContracts,
      allowedFunctions,
      allowedTokens,
      spendCap: dailyWei,
      perTransactionCap: maxTxWei,
      expiresAtMs,
    });

    // Record the risk hint on the session (informational).
    try {
      const db = getAdminDb();
      await db.collection(collections.agentSessions).doc(session.sessionId).update({ riskLevel });
    } catch {
      // Non-fatal: risk is informational.
    }

    let registeredSession = session;
    let registration: 'registered' | 'failed' = 'failed';
    try {
      registeredSession = await manager.registerSession(session.sessionId);
      registration = 'registered';
    } catch (regErr) {
      logger.warn('task_session_registration_failed', {
        sessionId: session.sessionId,
        correlationId: getCorrelationId(),
        err: regErr instanceof Error ? regErr.message : String(regErr),
      });
    }

    // Ensure the agent is ACTIVE so the loop may execute within its session.
    if (agent.status !== 'ACTIVE') {
      try {
        await agentRegistry.lifecycle(id, 'activate', user.developerId);
        logger.info('task_agent_activated', { agentId: id, correlationId: getCorrelationId() });
      } catch (lifecycleErr) {
        // Activation may require wallet/capability readiness; the task is still
        // created but the loop may stop at an honest 'awaited' state.
        logger.warn('task_agent_activation_failed', {
          agentId: id,
          correlationId: getCorrelationId(),
          err: lifecycleErr instanceof Error ? lifecycleErr.message : String(lifecycleErr),
        });
      }
    }

    // Run one closed loop immediately (honest result — never fabricated).
    const correlationId = getCorrelationId();
    let runResult: Record<string, unknown> | null = null;
    try {
      const result = await runAgentCycle({
        agentId: id,
        userId: user.developerId,
        correlationId,
        session: registeredSession,
      });
      // Build a Firestore-safe result: NEVER include undefined fields.
      // ok:true  -> { ok, stage, executionId? }
      // ok:false -> { ok, reason, code }
      const compact: Record<string, unknown> = { ok: result.ok };
      if (result.ok) {
        compact.stage = result.stage;
        if ('executionId' in result && result.executionId) compact.executionId = result.executionId;
      } else {
        compact.reason = result.reason;
        compact.code = result.code;
      }
      runResult = stripUndefined(compact) as Record<string, unknown>;
    } catch (runErr) {
      logger.error('task_initial_run_failed', { agentId: id, correlationId }, runErr);
      runResult = { ok: false, reason: 'cycle_error', code: ErrorCode.INTERNAL };
    }

    const task = await createTaskRecord(id, user.developerId, {
      network: 'BNB Smart Chain',
      chainId: 56,
      maxTxUsd,
      dailyLimitUsd,
      maxTxWei,
      dailyWei,
      allowedTokens: Array.isArray(b.allowedTokens) ? (b.allowedTokens as string[]) : [],
      allowedProtocols: Array.isArray(b.allowedProtocols) ? (b.allowedProtocols as string[]) : [],
      allowedFunctions,
      riskLevel,
      expiresAtMs,
    }, registeredSession.sessionId, runResult);

    logger.info('task_created_and_run', {
      agentId: id,
      taskId: task.taskId,
      sessionId: registeredSession.sessionId,
      registration,
      runOk: runResult?.ok,
      correlationId,
    });

    return NextResponse.json(
      { ok: true, task, session: registeredSession, registration, initialRun: runResult },
      { status: 201 }
    );
  } catch (err) {
    logger.error('task_create_failed', {}, err);
    return handleError(err);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getTokenFromRequest(_request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }
    const { id } = await params;
    const agent = await agentRegistry.getById(id);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not authorized to list tasks for this agent', {
        code: ErrorCode.POLICY_DENIED,
        correlationId: getCorrelationId(),
      });
    }

    const db = getAdminDb();
    const snap = await db
      .collection(collections.agentTasks ?? 'agent_tasks')
      .where('agentId', '==', id)
      .limit(50)
      .get();
    const items: TaskRecord[] = [];
    snap.forEach((doc) => items.push(doc.data() as TaskRecord));
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    return NextResponse.json({ ok: true, tasks: items });
  } catch (err) {
    logger.error('task_list_failed', {}, err);
    return handleError(err);
  }
}