import 'server-only';

/**
 * TASKS — the durable, user-visible unit of agent work (replaces the blunt
 * "Activate Agent" button with an explicit "Create Task" flow).
 *
 * POST /api/agents/:id/tasks  -> create a task + create/register the scoped
 *                                session (same bounded authority as the
 *                                sessions route), activate the agent, run one
 *                                closed-loop cycle immediately, and kick the
 *                                self-sustaining Inngest loop.
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
 *   - GRID STRATEGY BOUNDS (USD dollars, optional; only used by grid agents):
 *     gridLowerPriceUsd / gridUpperPriceUsd / gridCount / gridCapitalUsd /
 *     gridMaxOrderUsd — threaded through `strategyConfig` into the immediate
 *     run AND the Inngest tick, so the strategy observes the user's exact
 *     range instead of hermetic $500–$600 defaults ("687.06 cents" bug).
 *
 * A task is persisted in Firestore (`agent_tasks`) with its full resolved
 * config so the UI can show exactly what the backend runs with. It never
 * fabricates execution results: the immediate run's honest CycleResult is
 * returned as `initialRun` and also recorded as an audit event.
 *
 * Firestore safety: Firestore REJECTS `undefined` as a field value. The cycle
 * result is therefore sanitized with stripUndefined before it is embedded in
 * `lastRun.result` — an honest `{ ok: true, stage: 'awaited', note? }` (no
 * reason / no executionId) and an honest `{ ok: false, reason, code }` must
 * both persist without throwing "Cannot use undefined as a Firestore value".
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
import { resolveAllowedContracts, resolveAllowedTokens, canonicalizeAllowedFunctions } from '@/lib/session-resolution';
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
    funding?: {
      token: 'BNB' | 'USDT' | 'USDC';
      amount: string;
      txHash?: string;
      gasTxHash?: string;
      confirmedAt: string;
    };
    // Optional grid bounds — only present when the user set them (grid agents).
    gridLowerPriceUsd?: number;
    gridUpperPriceUsd?: number;
    gridCount?: number;
    gridCapitalUsd?: number;
    gridMaxOrderUsd?: number;
    autoRecenterOnBreak?: boolean;
    poolAddress?: string;
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

/** Parse optional grid fields from the request body (USD dollars). */
function extractGridConfig(b: Record<string, unknown>): {
  gridLowerPriceUsd?: number;
  gridUpperPriceUsd?: number;
  gridCount?: number;
  gridCapitalUsd?: number;
  gridMaxOrderUsd?: number;
  autoRecenterOnBreak?: boolean;
} {
  const out: {
    gridLowerPriceUsd?: number;
    gridUpperPriceUsd?: number;
    gridCount?: number;
    gridCapitalUsd?: number;
    gridMaxOrderUsd?: number;
    autoRecenterOnBreak?: boolean;
  } = {};
  const lower = Number(b.gridLowerPriceUsd ?? b.gridLowerUsd);
  const upper = Number(b.gridUpperPriceUsd ?? b.gridUpperUsd);
  const gridCount = Number(b.gridCount);
  const capital = Number(b.gridCapitalUsd ?? b.capitalUsd);
  const maxOrder = Number(b.gridMaxOrderUsd ?? b.maxOrderUsd);
  if (Number.isFinite(lower) && lower > 0) out.gridLowerPriceUsd = lower;
  if (Number.isFinite(upper) && upper > 0) out.gridUpperPriceUsd = upper;
  if (Number.isFinite(gridCount) && gridCount >= 2) out.gridCount = Math.floor(gridCount);
  if (Number.isFinite(capital) && capital > 0) out.gridCapitalUsd = capital;
  if (Number.isFinite(maxOrder) && maxOrder > 0) out.gridMaxOrderUsd = maxOrder;
  if (b.autoRecenterOnBreak === false) out.autoRecenterOnBreak = false;
  return out;
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

    const allowedFunctions = canonicalizeAllowedFunctions(
      Array.isArray(b.allowedFunctions)
        ? (b.allowedFunctions as string[]).map((s) => String(s).trim()).filter(Boolean)
        : (typeof b.allowedFunctions === 'string' && b.allowedFunctions ? b.allowedFunctions.split(',').map((s) => s.trim()).filter(Boolean) : [])
    );
    const riskLevel = typeof b.riskLevel === 'string' ? b.riskLevel : 'LOW';
    const expiresAtMs = typeof b.expiresAtMs === 'number' && b.expiresAtMs > Date.now() ? b.expiresAtMs : Date.now() + 30 * 24 * 60 * 60 * 1000;
    const rawFunding = b.funding && typeof b.funding === 'object' ? b.funding as Record<string, unknown> : null;
    const fundingToken = rawFunding?.token === 'BNB' || rawFunding?.token === 'USDT' || rawFunding?.token === 'USDC'
      ? rawFunding.token
      : null;
    const fundingAmount = rawFunding && typeof rawFunding.amount === 'string' && Number(rawFunding.amount) > 0
      ? rawFunding.amount
      : null;
    const funding = fundingToken && fundingAmount
      ? {
          token: fundingToken as 'BNB' | 'USDT' | 'USDC',
          amount: fundingAmount,
          txHash: typeof rawFunding?.txHash === 'string' ? rawFunding.txHash : undefined,
          gasTxHash: typeof rawFunding?.gasTxHash === 'string' ? rawFunding.gasTxHash : undefined,
          confirmedAt: new Date().toISOString(),
        }
      : undefined;

    // Grid bounds (optional, USD dollars) — persisted on the task row AND fed
    // to runAgentCycle so the strategy actually uses the user's range.
    const gridConfig = extractGridConfig(b);
    const poolAddress = typeof b.poolAddress === 'string' && /^0x[a-fA-F0-9]{40}$/.test(b.poolAddress)
      ? b.poolAddress
      : undefined;

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
    // strategyConfig = the task row's config (incl. grid bounds) so the very
    // first cycle observes with the USER's params, not the hermetic defaults.
    const correlationId = getCorrelationId();
    const strategyConfig: Record<string, unknown> = {
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
      poolAddress,
      funding,
      ...gridConfig,
    };

    let runResult: Record<string, unknown> | null = null;
    try {
      const result = await runAgentCycle({
        agentId: id,
        userId: user.developerId,
        correlationId,
        session: registeredSession,
        strategyConfig,
      });
      // Build a Firestore-safe result: NEVER include undefined fields.
      // ok:true  -> { ok, stage, executionId?, note? }
      // ok:false -> { ok, reason, code }
      const compact: Record<string, unknown> = { ok: result.ok };
      if (result.ok) {
        compact.stage = result.stage;
        if ('executionId' in result && result.executionId) compact.executionId = result.executionId;
        if ('note' in result && result.note) compact.note = result.note;
      } else {
        compact.reason = result.reason;
        compact.code = result.code;
      }
      runResult = stripUndefined(compact) as Record<string, unknown>;
    } catch (runErr) {
      logger.error('task_initial_run_failed', { agentId: id, correlationId }, runErr);
      runResult = { ok: false, reason: 'cycle_error', code: ErrorCode.INTERNAL };
    }

    const taskConfig: TaskRecord['config'] = {
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
      poolAddress,
      funding,
      ...gridConfig,
    };

    const task = await createTaskRecord(id, user.developerId, taskConfig, registeredSession.sessionId, runResult);

    // Kick the self-sustaining loop (Inngest ban/agent.tick-loop) so the
    // agent keeps running every ~2 minutes (heartbeat + next cycles) while
    // ACTIVE. This is an explicit kick, not Firestore-as-queue: Inngest owns
    // the schedule/delivery; the Firestore lease prevents overlapping chains.
    try {
      const { inngest } = await import('@/inngest/client');
      await inngest.send({
        name: 'ban/agent.tick-loop',
        data: {
          agentId: id,
          userId: user.developerId,
          correlationId,
        },
      });
      logger.info('task_loop_kicked', { agentId: id, taskId: task.taskId, correlationId });
    } catch (loopErr) {
      logger.warn('task_loop_kick_failed', {
        agentId: id,
        taskId: task.taskId,
        correlationId,
        err: loopErr instanceof Error ? loopErr.message : String(loopErr),
      });
    }

    logger.info('task_created_and_run', {
      agentId: id,
      taskId: task.taskId,
      sessionId: registeredSession.sessionId,
      registration,
      runOk: runResult?.ok,
      correlationId,
      grid: Object.keys(gridConfig).length > 0 ? gridConfig : undefined,
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