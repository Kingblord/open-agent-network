import 'server-only';

import { getAdminDb, collections } from '@/lib/firebase-admin';
import { agentRegistry } from '@/lib/agent-registry';
import { policyEngine } from '@/lib/policy/policy-engine-provider';
import { DevDataProvider, LiveDataProvider, type ToolAdapters } from '@ban/blockchain';
import { DevBrainAdapter, OpenRouterBrainAdapter, type BrainAdapter } from '@ban/ai';
import type {
  Agent,
  ActionProposal,
  Execution,
  Position,
  Session,
  Observation,
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
import { createAgentExecutionBackend, loadAgentKeystore } from '@/lib/altana-signer';
import { findActivePermissionForJob } from '@/lib/permissions/permission-repo';
import { PermissionResolver } from '@ban/eip7702';
import { getBnbUsdPrice } from '@/lib/bnb-price';

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
 *
 * Config-gap honesty: an unreachable/unconfigured live provider (missing RPC,
 * Gate-A mismatch, transient RPC/network timeout, rate limit), an un-bundled
 * strategy package (dynamic `import()` on a serverless runtime), or a missing
 * signer runtime is an ENVIRONMENT gap, not a transaction failure. It stops
 * the loop at the honest `awaited` state with an actionable `note` (persisted
 * on the task row) instead of a hard FAILED `ERR_INTERNAL`.
 */

const logger = createLogger('agent-runtime');

export type CycleResult =
  | { ok: true; stage: 'observed' | 'decided' | 'awaited' | 'submitted' | 'confirmed'; executionId?: string; note?: string }
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
  /** Optional AI-decision listener — persists the brain's real reasoning before a proposal is produced (THINKING stage). */
  onDecision?: (decision: { status: string; reasoning: string; decisionId?: string }) => void;
  /** Job this cycle belongs to (user-funds permission scoping). */
  jobId?: string;
  /** TRUE only for jobs that move the USER's own funds — requires an ACTIVE EIP-7702 permission before any execution. */
  requiresUserFunds?: boolean;
  /** Task-derived strategy config (grid bounds etc.) threaded into the strategy so user params actually drive observe(). */
  strategyConfig?: Record<string, unknown>;
  /** The USER's personal wallet address (EOA) — used to enrich observations with user's positions */
  userWalletAddress?: string;
}

async function getSessionForAgent(agentId: string): Promise<Session | null> {
  const db = getAdminDb();
  // Avoid composite index: single-field equality + in-memory newest-first.
  // CRITICAL FIX: pick the newest ACTIVE, non-expired session — NOT merely the
  // newest doc. Newer sessions can be REVOKED (a later task's cleanup, or a
  // failed re-registration), while an older ACTIVE one is the real authority.
  // Returning a REVOKED/PENDING/expired session made every cycle fail policy
  // with "Session not found"/"Session revoked" even though a valid session
  // existed (this is the "it always says Session not found" report).
  const snap = await db.collection(collections.agentSessions).where('agentId', '==', agentId).get();
  const now = Date.now();
  let found: Session | null = null;
  snap.forEach((d) => {
    const s = d.data() as Session;
    if (s.status !== 'ACTIVE') return;
    const expires = s.expiresAt ? new Date(s.expiresAt).getTime() : 0;
    if (expires && expires <= now) return; // expired — not usable
    if (!found || (s.createdAt ?? '') > (found.createdAt ?? '')) found = s;
  });
  return found;
}

/**
 * Resolve the OWNER's personal wallet (the address they linked in Settings,
 * stored on their developer record). This is the wallet whose Venus/Aave
 * positions the AI must observe — the AGENT wallet is separate and usually
 * empty. Returns null when the owner record or linked address is missing
 * (degrades to strategy-only observations, never a cycle failure).
 */
async function resolveOwnerWallet(ownerId: string | undefined): Promise<string | null> {
  if (!ownerId) return null;
  try {
    const db = getAdminDb();
    const snap = await db.collection(collections.users).doc(ownerId).get();
    const wallet = snap.data()?.walletAddress;
    if (typeof wallet === 'string' && /^0x[a-fA-F0-9]{40}$/.test(wallet)) return wallet;
    return null;
  } catch (err) {
    logger.warn('owner_wallet_resolve_failed', {
      ownerId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Stablecoin ERC-20 addresses (BSC mainnet, 18 decimals) whose wei value is
 * USD-denominated. Proposals SPENDING these tokens carry estimatedValue in
 * token wei (≈ USD × 1e18), which must be converted to a BNB-wei equivalent
 * before comparison against BNB-wei-denominated session caps.
 */
const STABLECOIN_ADDRESSES = new Set([
  '0x55d398326f99059fF775485246999027B3197955', // USDT
  '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
]);

/**
 * Convert a stablecoin estimatedValue to its BNB-wei equivalent so the
 * policy caps (denominated in BNB wei) and the spend ledger stay coherent.
 * Fixed-point: bnbWei = tokenWei × 1e6 / (priceUsd × 1e6). Fails closed
 * (throws) when the price feed is unavailable — never guesses a rate.
 */
async function normalizeProposalValueForCaps(
  proposal: ActionProposal,
  correlationId: string,
): Promise<ActionProposal> {
  // Health/yield canonical proposals set BOTH `token` (underlying spent) and
  // `params.underlying`. Prefer `token`; fall back to params.underlying so a
  // strategy that ever sets a vToken as `token` still normalizes correctly.
  const token = ((proposal.token ?? '').toLowerCase() ||
    String(proposal.params?.underlying ?? '').toLowerCase());
  if (!STABLECOIN_ADDRESSES.has(token)) return proposal; // BNB/WBNB-wei already

  const price = await getBnbUsdPrice();
  if (price == null || price <= 0) {
    throw new BANError(
      ErrorCode.POLICY_DENIED,
      'BNB/USD price unavailable — cannot value a stablecoin spend against the BNB-denominated session caps (fail-closed). No transaction was attempted.',
      { correlationId },
    );
  }

  const priceScaled = BigInt(Math.round(price * 1e6)); // USD × 1e6
  const tokenWei = BigInt(proposal.estimatedValue);
  const bnbWeiEquivalent = (tokenWei * 1000000n) / priceScaled;

  return { ...proposal, estimatedValue: bnbWeiEquivalent.toString() };
}

/** List CONFIRMED executions for a given agent (performance rollup input). */
async function listConfirmedExecutions(agentId: string): Promise<Execution[]> {  const db = getAdminDb();
  // Single-field equality (no composite index / orderBy).
  const snap = await db
    .collection(collections.executions)
    .where('agentId', '==', agentId)
    .get();
  const out: Execution[] = [];
  snap.forEach((d) => {
    const e = d.data() as Execution;
    if (e.status === 'CONFIRMED') out.push(e);
  });
  return out;
}

/** Build the execution backend, tolerating an unconfigured/unusable signer. */
async function resolveExecutionBackend(agentId: string): Promise<
  | ((input: { proposal: ActionProposal; session: unknown }) => Promise<{ transactionHash: string }>)
  | null
> {
  const agentKey = await loadAgentKeystore(agentId);
  if (!agentKey) {
    // No per-agent key yet — honest "awaiting provisioning", not a failure.
    logger.info('agent_awaiting_provisioning', { agentId });
    return null;
  }
  try {
    return await createAgentExecutionBackend(agentId);
  } catch (err) {
    // A configured signer that can't run in THIS execution (SDK load / an
    // unconfigured provider). This is NOT a transaction failure; keep the
    // honesty contract by surfacing it as an "awaiting execution" state with
    // the actionable reason instead of failing the cycle.
    const message =
      err instanceof BANError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    logger.warn('agent_awaiting_execution_signer_unavailable', { agentId, message });
    return null;
  }
}

/**
 * Categorize whether an error is an ENVIRONMENT/CONFIG gap vs a real failure.
 *
 * The honesty contract says a missing/unreachable provider, an un-bundled
 * strategy package (dynamic `import()` on a serverless runtime), a missing
 * signer runtime, or a transient RPC/network/timeout/rate-limit failure should
 * stop at an honest "awaiting execution" state with an actionable note — NOT a
 * hard task FAILED. These are config gaps, not transaction failures. Anything
 * else is a real failure and must surface.
 */
function isAwaitableConfigGap(err: unknown): boolean {
  const message =
    err instanceof BANError ? err.message : err instanceof Error ? err.message : String(err);

  // Import / module / provider / signer-runtime gaps (including on serverless).
  if (/import|failed to load|cannot find module|sdk|rpc|provider|keystore/i.test(message)) return true;

  // Raw network / DNS / timeout / rate-limit failures from viem / fetch.
  if (
    /fetch failed|request failed|failed to fetch|network|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timed out|aborted|rate.?limit|429/i.test(
      message,
    )
  ) {
    return true;
  }

  if (err instanceof BANError) {
    if (err.code === ErrorCode.PROVIDER_UNAVAILABLE) return true;
    if (err.code === ErrorCode.INTERNAL) {
      // Already covered by the message regex above.
    }
  }
  return false;
}

/** Surface an actionable message for a config-gap that stops a cycle. */
function configGapNote(err: unknown): string {
  const message =
    err instanceof BANError ? err.message : err instanceof Error ? err.message : String(err);
  return `Execution pending — ${sanitizeErrorMessage(message)}. Check BAN_LIVE_DATA / BAN_RPC_URL / strategy package bundling. No transaction was broadcast.`;
}

/**
 * Sanitize an error message before it is persisted or surfaced: redact anything
 * that looks like a private key / long hex secret and cap the length. The real
 * reason is preserved, secrets are never leaked.
 */
function sanitizeErrorMessage(message: string): string {
  if (!message) return 'unknown error';
  // Redact 40+ char hex strings (private keys / tx-safe hashes are never secrets
  // here, but a leaked key must never be persisted to the task row).
  const redacted = message.replace(/0x[0-9a-fA-F]{40,}/g, '0x[redacted]');
  const max = 300;
  return redacted.length <= max ? redacted : `${redacted.slice(0, max)}…`;
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

    // 2) Load grid state from Firestore and resolve volatility (survives serverless cycles).
    const dev = await resolveDataProvider();
    let volatilityBps: number | undefined;
    if (dev.chain?.getVolatilityBps) {
      try { volatilityBps = await dev.chain.getVolatilityBps({ action: 'grid-trading' }); }
      catch { /* use default 150 */ }
    }
    let persistedGridState: Record<string, unknown> | undefined;
    let saveGridState: ((state: Record<string, unknown>) => void) | undefined;
    if (agent.type === 'grid') {
      try {
        const { loadGridState, persistGridState } = await import('./persistence');
        persistedGridState = await loadGridState(agentId) ?? undefined;
        saveGridState = (state: Record<string, unknown>) => {
          persistGridState(agentId, state).catch((err: Error) =>
            logger.warn('grid_state_persist_failed', { agentId, message: err.message }),
          );
        };
      } catch { /* persistence unavailable — use in-memory only */ }
    }

    // Resolve the OWNER's wallet once (used both for the health strategy's
    // authoritative snapshot and for observation enrichment below).
    const ownerWalletAddress = opts.userWalletAddress ?? (await resolveOwnerWallet(agent.ownerId));

    // 3) Preflight: validate the strategy config before the first cycle.
    const strategy: import('@ban/agent-core').StrategyEngine =
      opts.strategy ??
      (await resolveStrategy(agent, opts.strategyConfig, {
        volatilityBps,
        persistedGridState,
        saveGridState,
        userWalletAddress: ownerWalletAddress ?? undefined,
      }));
    if (strategy.preflight) {
      const preflightResult = await strategy.preflight(agent);
      if (!preflightResult.ok) {
        await persistAuditEvent({
          type: 'AGENT_CYCLE_ERROR',
          correlationId,
          agentId,
          userId,
          detail: { stage: 'preflight', reason: preflightResult.reason },
        });
        return { ok: false, reason: `preflight: ${preflightResult.reason}`, code: ErrorCode.VALIDATION_FAILED };
      }
    }

    // 3) Observe (real strategy adapter). Task-derived config is threaded in so
    //    user-set bounds/caps reach the strategy (fixes hardcoded grid bounds).
    const observations = await strategy.observe(agent, correlationId);

    // Enrich observations with the OWNER's personal protocol positions. This
    // is what lets the AI see the USER's wallet state — Venus vUSDT/vBNB
    // deposits, Aave positions, token balances — not just the (usually empty)
    // agent wallet. Resolved from the owner's developer record (the address
    // they linked in Settings); a missing link degrades to strategy-only
    // observations, never a failure.
    const enrichedObs = ownerWalletAddress
      ? await enrichObservationsWithUserPositions(observations, ownerWalletAddress, agent)
      : observations;

    await persistAuditEvent({
      type: 'AGENT_OBSERVED',
      correlationId,
      agentId,
      userId,
      detail: { count: enrichedObs.length, strategyId: agent.strategyId },
    });

    // 3) Decide (inside strategy, via injected brain). Re-validated downstream.
    let proposal: ActionProposal | null = null;
    for (const obs of enrichedObs) {
      const resolved = await strategy.decide(obs, agent, {
        onDecision: (decision) => {
          // Persist the AI's REAL reasoning before policy/proposal — this is what
          // the REVIEW TERMINAL THINKING stage displays. Never fabricated.
          void persistAuditEvent({
            type: 'AI_DECISION_CREATED',
            correlationId,
            agentId,
            userId,
            detail: {
              status: decision.status,
              decisionId: decision.decisionId,
              reasoning: decision.reasoning,
            },
          }).catch((err) => {
            logger.warn('ai_decision_persist_failed', {
              agentId,
              correlationId,
              message: err instanceof Error ? err.message : String(err),
            });
          });
        },
      });
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

    // 3b) REAL-FUNDS CAP COHERENCE: session spend caps are denominated in BNB
    // wei (the task form converts USD inputs at the BNB price), but stablecoin
    // proposals carry estimatedValue in token wei (USDT wei ≈ dollars × 1e18 —
    // ~600× a BNB-wei equivalent at $600). Comparing raw token wei against a
    // BNB-wei cap denies virtually every legitimate stablecoin action. Convert
    // stablecoin estimatedValue to its BNB-wei equivalent (price from the same
    // cached CoinGecko feed the task form used). Keyed on the SPENT token
    // address (proposal.token = tokenIn) — a WBNB-in sell is already BNB-wei
    // and is never converted. Fail closed when the price is unavailable.
    const policyProposal = await normalizeProposalValueForCaps(proposal, correlationId);

    // 4) Policy gate (validate + reserve) — M5. Fails closed.
    //
    // SESSION ID TRUST (root cause of "Session not found"): the model invents
    // a `sessionId` in its proposal (`session-456`, etc.). That id is NOT a
    // real agent_sessions document — it came from the LLM. Policy must
    // evaluate against the RESOLVED session (line ~288: opts.session ?? the
    // newest ACTIVE session for this agent), never the model's claim. Using
    // the model's id made every cycle fail with "Session not found" even when
    // a real active session existed, and would let a model reference arbitrary
    // sessions. Stamp the real sessionId onto the policy proposal here.
    const policyProposalWithSession = session
      ? { ...policyProposal, sessionId: session.sessionId }
      : policyProposal;

    const policy = await policyEngine.validateAction(policyProposalWithSession, {
      agentId: agent.id,
      userId,
      sessionId: session?.sessionId ?? proposal.sessionId,
    });

    if (policy.decision === 'DENY') {
      await persistAuditEvent({
        type: 'AGENT_POLICY_DENIED',
        correlationId,
        agentId,
        userId,
        proposalId: proposal.proposalId,
        sessionId: session?.sessionId ?? proposal.sessionId,
        severity: 'WARN',
        detail: { deniedCheck: policy.deniedCheck ?? 'unknown', reason: policy.reason },
      });
      return { ok: false, reason: policy.reason ?? 'policy_denied', code: ErrorCode.POLICY_DENIED };
    }

    // 4b) User-funds gate (update-v3 §8–§11): jobs that move the USER's own funds
    // (`requiresUserFunds`) require an ACTIVE EIP-7702-backed permission BEFORE any
    // execution. Operational (Altana) jobs skip this gate. Fails closed: a missing,
    // expired, revoked, or out-of-scope permission DENIES the proposal — the agent can
    // never spend user funds without one. No permission ⇒ no execution ⇒ no fabricate.
    if (opts.requiresUserFunds) {
      const permission = await findActivePermissionForJob(agent.id, opts.jobId ?? '');
      let permissionError: unknown = null;
      if (!permission) {
        permissionError = new Error('No ACTIVE user-funds permission bound to this agent+job');
      } else {
        try {
          new PermissionResolver().resolve(permission, {
            protocol: proposal.protocol ?? '',
            contract: proposal.contract ?? '',
            functionName: proposal.function ?? '',
            token: proposal.asset ?? '',
            amount: proposal.amount ?? '0',
          });
        } catch (err) {
          permissionError = err;
        }
      }
      if (permissionError) {
        const reason = permissionError instanceof Error ? permissionError.message : String(permissionError);
        await persistAuditEvent({
          type: 'AGENT_POLICY_DENIED',
          correlationId,
          agentId,
          userId,
          proposalId: proposal.proposalId,
          sessionId: proposal.sessionId,
          severity: 'WARN',
          detail: { deniedCheck: 'user_funds_permission', reason },
        });
        return {
          ok: false,
          reason: `user_funds_job_no_active_permission: ${reason}`,
          code: ErrorCode.POLICY_DENIED,
        };
      }
    }

    // 5) Execution — only when a real backend is available AND session ACTIVE.
    // Resolve a per-agent executor (its own wallet/keystore). When not
    // provisioned, signer-unavailable, or injected, stop at the honest
    // `awaited` state.
    const backend = opts.execute ?? (await resolveExecutionBackend(agent.id));

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
            ? 'Execution backend unavailable (no provisioned signer or signer could not be loaded in this runtime). No transaction was broadcast.'
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

    const executionId = `exec_${proposal.proposalId.slice(-24)}`;

    // Honesty guard: only a tx-hash-shaped id (0x + 64 hex) is a real broadcast
    // transaction. Altana may return a `callsId` (batch id) — that is SUBMITTED,
    // not confirmed. Marking those CONFIRMED would fabricate success.
    const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
    const isBroadcastTx = TX_HASH_RE.test(submitted.transactionHash);

    if (!isBroadcastTx) {
      await persistExecution({
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
        status: 'EXECUTING',
        errorCode: null,
        createdAt: new Date().toISOString(),
        confirmedAt: null,
      });
      await persistAuditEvent({
        type: 'AGENT_EXECUTION_PENDING',
        correlationId,
        agentId,
        userId,
        proposalId: proposal.proposalId,
        sessionId: proposal.sessionId,
        executionId,
        severity: 'INFO',
        detail: {
          note: `Submitted via execution backend (id ${submitted.transactionHash}); awaiting on-chain confirmation before recording a position.`,
        },
      });
      // Honest intermediate state: submitted, not yet confirmed. No position,
      // no performance rollup — those are only written on real confirmation.
      return { ok: true, stage: 'submitted', executionId };
    }

    const confirmedAt = new Date().toISOString();
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
    if (isAwaitableConfigGap(err)) {
      // Environment/config gap (unreachable provider, un-bundled strategy
      // package, missing signer runtime, transient RPC/network failure).
      // Honest "awaiting" stop — not a failure — matching the documented
      // contract. The real reason is preserved so the task row shows what to
      // fix.
      const note = configGapNote(err);
      await persistAuditEvent({
        type: 'AGENT_EXECUTION_PENDING',
        correlationId,
        agentId,
        userId,
        severity: 'INFO',
        detail: { note },
      });
      logger.warn('agent_cycle_awaiting_config', { agentId, correlationId, note });
      return { ok: true, stage: 'awaited', note };
    }
    // A real failure — surface the code AND the sanitized real message so the
    // task row / API shows exactly what happened (never a bare ERR_INTERNAL).
    const code = err instanceof BANError ? err.code : ErrorCode.INTERNAL;
    const message = err instanceof BANError ? err.message : err instanceof Error ? err.message : String(err);
    logger.error('agent_cycle_failed', { agentId, correlationId }, err);
    return { ok: false, reason: `cycle_error:${code}: ${sanitizeErrorMessage(message)}`, code };
  }
}

/**
 * Enrich observations with the USER's personal wallet protocol state.
 *
 * Every strategy observes general market data (prices, yields, pools). This
 * function adds the USER's personal on-chain positions as a supplemental
 * observation so the AI can see the user's actual wallet state — Venus
 * deposits, Aave positions, LP positions, and token balances — regardless
 * of which strategy is running.
 *
 * The result is appended alongside the strategy's own observations. The AI
 * receives BOTH its strategy-specific data AND the user's positions, so it
 * can make informed decisions about the user's actual DeFi state.
 */
async function enrichObservationsWithUserPositions(
  observations: Observation[],
  userWalletAddress: string,
  agent: Agent,
): Promise<Observation[]> {
  const enriched = [...observations];
  const dataProvider = process.env.BAN_LIVE_DATA === '1'
    ? LiveDataProvider.instance()
    : DevDataProvider.instance();

  // 1) Token balances (BNB + core assets)
  const balances: Record<string, string> = {};
  try {
    const bnb = await dataProvider.chain.getTokenBalance({ token: 'BNB', address: userWalletAddress });
    balances.BNB = bnb.balance;
  } catch { /* skip */ }
  for (const token of ['USDT', 'USDC', 'WBNB']) {
    try {
      const t = await dataProvider.chain.getTokenBalance({ token, address: userWalletAddress });
      balances[token] = t.balance;
    } catch { /* skip */ }
  }

  if (Object.keys(balances).length > 0) {
    enriched.push({
      id: `user_balances_${Date.now()}`,
      type: 'user_balances',
      agentId: agent.id,
      data: {
        wallet: userWalletAddress,
        balances,
        note: 'User wallet token balances at observation time',
      },
      observedAt: new Date().toISOString(),
    } as unknown as Observation);
  }

  // 2) Venus lending positions (user's personal deposits)
  try {
    const venus = await dataProvider.lending.getLendingPosition(userWalletAddress, 'venus');
    if (venus && BigInt(venus.collateral) > 0n) {
      enriched.push({
        id: `user_venus_${Date.now()}`,
        type: 'user_protocol_position',
        agentId: agent.id,
        data: {
          protocol: 'venus',
          wallet: userWalletAddress,
          collateralUsd: venus.collateral,
          borrowedUsd: venus.borrowed,
          healthFactor: venus.healthFactor,
          liquidationThreshold: venus.liquidationThreshold,
          ltv: venus.ltv,
          note: 'User Venus lending position at observation time',
        },
        observedAt: new Date().toISOString(),
      } as unknown as Observation);
    }
  } catch { /* skip */ }

  // 3) Aave V3 positions (user's personal deposits)
  try {
    const aave = await dataProvider.lending.getLendingPosition(userWalletAddress, 'aave');
    if (aave && BigInt(aave.collateral) > 0n) {
      enriched.push({
        id: `user_aave_${Date.now()}`,
        type: 'user_protocol_position',
        agentId: agent.id,
        data: {
          protocol: 'aave',
          wallet: userWalletAddress,
          collateralUsd: aave.collateral,
          borrowedUsd: aave.borrowed,
          healthFactor: aave.healthFactor,
          liquidationThreshold: aave.liquidationThreshold,
          ltv: aave.ltv,
          note: 'User Aave V3 lending position at observation time',
        },
        observedAt: new Date().toISOString(),
      } as unknown as Observation);
    }
  } catch { /* skip */ }

  // 4) Lista positions (user's personal deposits)
  try {
    const lista = await dataProvider.lending.getLendingPosition(userWalletAddress, 'lista');
    if (lista && BigInt(lista.collateral) > 0n) {
      enriched.push({
        id: `user_lista_${Date.now()}`,
        type: 'user_protocol_position',
        agentId: agent.id,
        data: {
          protocol: 'lista',
          wallet: userWalletAddress,
          collateralUsd: lista.collateral,
          borrowedUsd: lista.borrowed,
          healthFactor: lista.healthFactor,
          note: 'User Lista lending position at observation time',
        },
        observedAt: new Date().toISOString(),
      } as unknown as Observation);
    }
  } catch { /* skip */ }

  return enriched;
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
  if (process.env.NODE_ENV === 'production') {
    throw new BANError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      'Production agent cycles require BAN_LIVE_DATA=1; the hermetic dev data provider is disabled in production.',
      { retryable: false },
    );
  }
  return DevDataProvider.instance();
}

/**
 * Resolve the brain provider:
 *   - BAN_AI_PROVIDER=openrouter  -> OpenRouterBrainAdapter (REAL inference;
 *     reads OPENROUTER_API_KEY / OPENROUTER_MODEL). If the key is missing it
 *     throws PROVIDER_UNAVAILABLE -> isAwaitableConfigGap -> honest "awaited".
 *   - otherwise (default)         -> DevBrainAdapter (hermetic, deterministic,
 *     fail-closed, no network). Never fabricates.
 */
function resolveBrainProvider(): BrainAdapter {
  if (process.env.BAN_AI_PROVIDER === 'openrouter') {
    logger.info('brain_provider_openrouter_enabled', { provider: 'openrouter' });
    return new OpenRouterBrainAdapter();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new BANError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      'Production agent cycles require BAN_AI_PROVIDER=openrouter; the deterministic dev brain is disabled in production.',
      { retryable: false },
    );
  }
  logger.info('brain_provider_dev_enabled', { provider: 'dev' });
  return new DevBrainAdapter();
}

/** Grid bounds from task config (USD dollars → integer cents) + gridCount/capital. */
function resolveGridConfigFromTask(taskConfig?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!taskConfig || typeof taskConfig !== 'object') return undefined;
  const grid = (taskConfig.grid ?? taskConfig) as Record<string, unknown>;
  const lowerUsd = Number(grid.gridLowerPriceUsd ?? grid.gridLowerUsd);
  const upperUsd = Number(grid.gridUpperPriceUsd ?? grid.gridUpperUsd);
  const gridCount = Number(grid.gridCount);
  const capitalUsd = Number(grid.gridCapitalUsd ?? grid.capitalUsd);
  const maxOrderUsd = Number(grid.gridMaxOrderUsd ?? grid.maxOrderUsd);
  const out: Record<string, unknown> = {};
  if (Number.isFinite(lowerUsd) && lowerUsd > 0) out.lowerPriceCents = Math.round(lowerUsd * 100);
  if (Number.isFinite(upperUsd) && upperUsd > 0) out.upperPriceCents = Math.round(upperUsd * 100);
  if (Number.isFinite(gridCount) && gridCount >= 2) out.gridCount = Math.floor(gridCount);
  if (Number.isFinite(capitalUsd) && capitalUsd > 0) out.capitalCents = Math.round(capitalUsd * 100);
  if (Number.isFinite(maxOrderUsd) && maxOrderUsd > 0) out.maxOrderSizeCents = Math.round(maxOrderUsd * 100);
  if (grid.autoRecenterOnBreak === false) out.autoRecenterOnBreak = false;
  return Object.keys(out).length > 0 ? out : undefined;
}

async function resolveStrategy(
  agent: Agent,
  taskConfig?: Record<string, unknown>,
  extra?: {
    volatilityBps?: number;
    persistedGridState?: Record<string, unknown>;
    saveGridState?: (state: Record<string, unknown>) => void;
    userWalletAddress?: string;
  },
): Promise<import('@ban/agent-core').StrategyEngine> {
  const brain = resolveBrainProvider(); // deterministic or real AI per env
  const type = agent.type ?? '';
  const dev = await resolveDataProvider();

  if (type === 'yield') {
    const { YieldDataProvider, YieldStrategy } = await import('@ban/strategy-yield');
    // Pass live gas estimates from the chain adapter to the yield normalizer.
    const yieldConfig = { ...(taskConfig ?? {}) };
    if (dev.chain?.getGasEstimate) {
      try {
        const gas = await dev.chain.getGasEstimate({ action: 'yield-swap' });
        if (gas.estimatedCostUsd && Number(gas.estimatedCostUsd) > 0) {
          // Convert gas cost in USD to bps: assume ~$10k swap → gas/10000*10000
          yieldConfig.swapCostBps = Math.max(5, Math.round(Number(gas.estimatedCostUsd) * 10));
        }
      } catch { /* use defaults */ }
    }
    return new YieldStrategy({
      brain,
      data: new YieldDataProvider(dev.yield),
      network: 'bnb-mainnet',
      config: yieldConfig,
    });
  }
  if (type === 'health') {
    const { HealthDataProvider, HealthStrategy } = await import('@ban/strategy-health');
    return new HealthStrategy({
      brain,
      data: new HealthDataProvider(dev.lending, dev.price),
      // The health monitor reads the OWNER's personal wallet (authoritative
      // collateral/debt snapshot), falling back to the agent wallet when the
      // owner has no linked address.
      config: {
        ...(taskConfig ?? {}),
        userWalletAddress: extra?.userWalletAddress ?? undefined,
      },
    });
  }
  if (type === 'lp') {
    const { LpDataProvider, LpStrategy } = await import('@ban/strategy-lp');
    return new LpStrategy({
      brain,
      data: new LpDataProvider({ liquidity: dev.liquidity, price: dev.price, chain: dev.chain }),
      config: taskConfig,
    });
  }
  if (type === 'grid') {
    const { GridDataProvider, GridStrategy } = await import('@ban/strategy-grid');
    const gridConfig = resolveGridConfigFromTask(taskConfig);
    return new GridStrategy({
      brain,
      data: new GridDataProvider({ price: dev.price }),
      config: gridConfig,
      volatilityBps: extra?.volatilityBps ?? 150,
      persistedState: extra?.persistedGridState as any,
      onStateChanged: extra?.saveGridState as any,
    });
  }
  throw new BANError(ErrorCode.VALIDATION_FAILED, `No strategy engine for agent type '${type}'`, {
    retryable: false,
  });
}