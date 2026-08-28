import 'server-only';

import { getAdminDb, collections } from '@/lib/firebase-admin';
import { agentRegistry } from '@/lib/agent-registry';
import { policyEngine } from '@/lib/policy/policy-engine-provider';
import { DevDataProvider, LiveDataProvider, type ToolAdapters } from '@ban/blockchain';
import { DevBrainAdapter } from '@ban/ai';
import type {
  Agent,
  ActionProposal,
  Execution,
  Position,
  Session,
} from '@ban/schemas';
import { BANError, ErrorCode, createLogger } from '@ban/shared';
import {
  persistAuditEvent,
  persistExecution,
  upsertPosition,
  upsertPerformance,
  listPositions,
} from './persistence';
import { PerformanceCalculator, classifyExecutionMode } from '@ban/performance-engine';
import { createAgentExecutionBackend } from '@/lib/altana-signer';

/**
 * BAN Agent Runtime — closed-loop orchestration (Batch C).
 *
 * Drives a deployed agent through:
 *   OBSERVE → REASON(inside strategy via injected brain) → PROPOSE
 *   → POLICY (validate + reserve) → EXECUTE (confirms on a REAL backend)
 *   → POSITION → PERFORMANCE → AUDIT
 *
 * Honesty contract (non-negotiable):
 *   - This runtime NEVER fabricates a confirmed transaction, a position, or a
 *     performance figure. Without a configured real signing/provider backend it
 *     stops at an honest "awaiting execution" state and records an
 *     `AGENT_EXECUTION_PENDING` audit event instead of a fake CONFIRMED.
 *   - Every stage that actually produces an output persists that output (real).
 *
 * Per-agent wallet (mustflow §27–28): each deployed agent owns a DEDICATED
 * wallet/signer provisioned at deploy time (see lib/altana-signer). run-cycle
 * resolves the executor per `agentId`; if the agent has no keystore yet, the
 * loop stops at the honest `awaited` state.
 *
 * Data plane (Milestone 6 / Rule 7): observations come from a REAL BNB data
 * provider when `BAN_LIVE_DATA=1` (LiveDataProvider — viem reads on BNB
 * mainnet 56, Gate-A chain verified, fail-closed). Otherwise it falls back to
 * the hermetic DevDataProvider for offline dev/tests ONLY. Nothing is
 * fabricated in either mode.
 */

const logger = createLogger('agent-runtime');

export type CycleResult =
  | { ok: true; stage: 'observed' | 'decided' | 'awaited' | 'confirmed'; executionId?: string }
  | { ok: false; reason: string; code: ErrorCode };

export interface RunCycleOptions {
  agentId: string;
  userId: string;
  correlationId: string;
  /** Optional injected session (used by tests); otherwise resolved from the agent. */
  session?: Session;
  /** Optional injected strategy engine; otherwise resolved from the agent's type. */
  strategy?: import('@ban/agent-core').StrategyEngine;
  /** Optional execution backend. When absent, the loop stops at AWAIT_EXECUTION (honest). */
  execute?: (input: { proposal: ActionProposal; session: Session }) => Promise<{ transactionHash: string }>;
}

async function getSessionForAgent(agentId: string): Promise<Session | null> {
  const db = getAdminDb();
  // Avoid composite index: single-field equality + in-memory newest-first.
  const snap = await db.collection(collections.agentSessions).where('agentId', '==', agentId).get();
  let found: Session | null = null;
  snap.forEach((d) => {
    const s = d.data() as Session;
    if (!found || (s.createdAt ?? '') > (found.createdAt ?? '')) found = s;
  });
  return found;
}

/**
 * Run one closed-loop cycle for a deployed agent.
 */
export async function runAgentCycle(opts: RunCycleOptions): Promise<CycleResult> {
  const { agentId, userId, correlationId } = opts;

  try {
    const agent = await agentRegistry.getById(agentId);
    if (!agent) {
      return { ok: false, reason: 'agent_not_found', code: ErrorCode.VALIDATION_FAILED };
    }

    // 1) Resolve the session (must be ACTIVE for execution).
    const session = opts.session ?? (await getSessionForAgent(agentId));

    // 2) Observe (real strategy adapter).
    const strategy: import('@ban/agent-core').StrategyEngine =
      opts.strategy ?? (await resolveStrategy(agent));
    const observations = await strategy.observe(agent, correlationId);
    await persistAuditEvent({
      type: 'AGENT_OBSERVED',
      correlationId,
      agentId,
      userId,
      detail: { count: observations.length, strategyId: agent.strategyId },
    });

    // 3) Decide (inside strategy, via injected brain). Re-validated downstream.
    let proposal: ActionProposal | null = null;
    for (const obs of observations) {
      const resolved = await strategy.decide(obs, agent);
      if (resolved) {
        proposal = resolved;
        break;
      }
    }

    if (!proposal) {
      // The agent reasoned and chose PASS (honest no-op).
      await persistAuditEvent({
        type: 'AGENT_PASSED',
        correlationId,
        agentId,
        userId,
        detail: { strategyId: agent.strategyId },
      });
      return { ok: true, stage: 'decided' };
    }

    await persistAuditEvent({
      type: 'AGENT_PROPOSED',
      correlationId,
      agentId,
      userId,
      proposalId: proposal.proposalId,
      sessionId: proposal.sessionId,
      detail: { action: proposal.action, contract: proposal.contract, function: proposal.function },
    });

    // 4) Policy gate (validate + reserve) — M5. Fails closed.
    const policy = await policyEngine.validateAction(proposal, {
      agentId: agent.id,
      userId,
      sessionId: proposal.sessionId,
    });

    if (policy.decision === 'DENY') {
      await persistAuditEvent({
        type: 'AGENT_POLICY_DENIED',
        correlationId,
        agentId,
        userId,
        proposalId: proposal.proposalId,
        sessionId: proposal.sessionId,
        severity: 'WARN',
        detail: { deniedCheck: policy.deniedCheck ?? 'unknown', reason: policy.reason },
      });
      return { ok: false, reason: policy.reason ?? 'policy_denied', code: ErrorCode.POLICY_DENIED };
    }

    // 5) Execution — only when a real backend is available AND session ACTIVE.
    // Resolve a per-agent executor (its own wallet/keystore). When not
    // provisioned or injected, stop at the honest `awaited` state.
    const backend = opts.execute ?? (await createAgentExecutionBackend(agent.id));

    const canExecute =
      Boolean(backend) &&
      Boolean(session) &&
      session!.status === 'ACTIVE' &&
      agent.status === 'ACTIVE';

    if (!canExecute) {
      await persistAuditEvent({
        type: 'AGENT_EXECUTION_PENDING',
        correlationId,
        agentId,
        userId,
        proposalId: proposal.proposalId,
        sessionId: proposal.sessionId,
        severity: 'INFO',
        detail: {
          note: !backend
            ? 'Agent wallet not provisioned; awaiting provisioning. No transaction was broadcast.'
            : 'Session not ACTIVE or agent not ACTIVE; awaiting execution. No transaction was broadcast.',
        },
      });
      return { ok: true, stage: 'awaited' };
    }

    // 6) Session-gated sign/execution via this agent's own backend.
    const submitted = await backend!({ proposal, session: session! });
    if (!submitted?.transactionHash) {
      return { ok: false, reason: 'execution_no_hash', code: ErrorCode.EXECUTION_FAILED };
    }

    const confirmedAt = new Date().toISOString();
    const executionId = `exec_${proposal.proposalId.slice(-24)}`;
    const execution: Execution = {
      executionId,
      proposalId: proposal.proposalId,
      agentId: agent.id,
      userId,
      protocol: proposal.protocol,
      contract: proposal.contract,
      function: proposal.function,
      parametersHash: JSON.stringify(proposal.params ?? {}),
      transactionHash: submitted.transactionHash,
      chainId: 56,
      gasUsed: null,
      status: 'CONFIRMED',
      errorCode: null,
      createdAt: new Date().toISOString(),
      confirmedAt,
    };
    await persistExecution(execution);

    await persistAuditEvent({
      type: 'TRANSACTION_CONFIRMED',
      correlationId,
      agentId,
      userId,
      proposalId: proposal.proposalId,
      sessionId: proposal.sessionId,
      executionId,
      detail: { transactionHash: submitted.transactionHash },
    });

    // 6) Position from real confirmed output (only for position-bearing actions).
    if (proposal.action === 'DEPOSIT' || proposal.action === 'SWAP') {
      await upsertPosition({
        positionId: `pos_${proposal.proposalId.slice(-24)}`,
        agentId: agent.id,
        protocol: proposal.protocol,
        contract: proposal.contract,
        asset: proposal.asset,
        amount: proposal.amount,
        entryValueUsd: proposal.estimatedValue,
        currentValueUsd: proposal.estimatedValue,
        openedAt: confirmedAt,
        updatedAt: confirmedAt,
      });
    }

    // 7) Performance rollup from REAL confirmed executions.
    const confirmedExecutions = await listConfirmedExecutions(agentId);
    const positions = await listPositions(agentId);
    const summary = new PerformanceCalculator().summarize(confirmedExecutions, positions);
    const mode = classifyExecutionMode(56, summary.confirmedCount);
    await upsertPerformance({
      performanceId: `perf_${agent.id.slice(-20)}`,
      agentId: agent.id,
      startAt: new Date().toISOString(),
      realizedPnlUsd: summary.realizedPnlUsd ?? '0',
      unrealizedPnlUsd: summary.unrealizedPnlUsd ?? '0',
      totalTrades: summary.confirmedCount,
      winRate: summary.successRate,
      maxDrawdownUsd: summary.maxDrawdownUsd ?? '0',
      updatedAt: new Date().toISOString(),
    });

    return { ok: true, stage: 'confirmed', executionId };
  } catch (err) {
    const code = err instanceof BANError ? err.code : ErrorCode.INTERNAL;
    logger.error('agent_cycle_failed', { agentId, correlationId }, err);
    return { ok: false, reason: `cycle_error:${code}`, code };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the data provider (Milestone 6 / Rule 7):
 *   - BAN_LIVE_DATA=1  → LiveDataProvider (real BNB mainnet reads, Gate-A
 *     chain-verified, fail-closed). If verification fails, this THROWS so the
 *     cycle fails honestly rather than observing fabricated data.
 *   - otherwise        → DevDataProvider (hermetic dev/test adapter only).
 */
async function resolveDataProvider(): Promise<ToolAdapters> {
  if (process.env.BAN_LIVE_DATA === '1') {
    const live = LiveDataProvider.instance();
    await live.verify(); // throws fail-closed unless RPC is real BNB mainnet (56)
    logger.info('live_data_provider_enabled');
    return live;
  }
  return DevDataProvider.instance();
}

/** Resolve the strategy engine by agent type + the dev brain (honest). */
async function resolveStrategy(agent: Agent): Promise<import('@ban/agent-core').StrategyEngine> {
  const brain = new DevBrainAdapter(); // deterministic, no-fabrication reasoning layer
  const type = agent.type ?? '';
  const dev = await resolveDataProvider();

  if (type === 'yield') {
    const { YieldDataProvider, YieldStrategy } = await import('@ban/strategy-yield');
    return new YieldStrategy({
      brain,
      data: new YieldDataProvider(dev.yield),
      network: 'bnb-mainnet',
    });
  }
  if (type === 'health') {
    const { HealthDataProvider, HealthStrategy } = await import('@ban/strategy-health');
    return new HealthStrategy({
      brain,
      data: new HealthDataProvider(dev.lending, dev.price),
    });
  }
  if (type === 'lp') {
    const { LpDataProvider, LpStrategy } = await import('@ban/strategy-lp');
    return new LpStrategy({
      brain,
      data: new LpDataProvider({ liquidity: dev.liquidity, price: dev.price }),
    });
  }
  if (type === 'grid') {
    const { GridDataProvider, GridStrategy } = await import('@ban/strategy-grid');
    return new GridStrategy({
      brain,
      data: new GridDataProvider({ price: dev.price }),
    });
  }
  throw new BANError(ErrorCode.AGENT_INACTIVE, `No strategy registered for agent type '${type}'`);
}

async function listConfirmedExecutions(agentId: string): Promise<Execution[]> {
  const db = getAdminDb();
  // Single-field equality (no composite index / orderBy).
  const snap = await db.collection(collections.executions).where('agentId', '==', agentId).get();
  const out: Execution[] = [];
  snap.forEach((d) => {
    const e = d.data() as Execution;
    if (e.status === 'CONFIRMED') out.push(e);
  });
  return out;
}