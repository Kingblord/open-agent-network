import type {
  ActionProposal,
  Agent,
  PolicyDecision,
  PolicyRuleResult,
  Session,
  SpendLedgerEntry,
} from '@ban/schemas';
import { BANError, ErrorCode, createLogger, type StructuredLogger } from '@ban/shared';
import type { PolicyEngine as PolicyEngineInterface } from '@ban/agent-core';

/**
 * Deterministic Policy Engine (Milestone 5).
 *
 * This is the safety gate between AI reasoning and onchain execution. It is
 * intentionally deterministic: no LLM output can influence these checks. The
 * engine is framework-agnostic (no Next.js / React / Vercel / Inngest).
 *
 * The engine implements BOTH policy evaluation AND atomic reserve-before-
 * execute spend accounting. When a proposal is allowed, it atomically reserves
 * the proposed spend against the session's cumulative cap so concurrent jobs
 * cannot collectively exceed the cap. A reservation flows through
 * RESERVED -> COMMITTED (confirmed success) or RESERVED -> RELEASED
 * (definitive failure), and stays RESERVED while transaction state is unknown
 * (awaiting reconciliation).
 */

// ---------------------------------------------------------------------------
// Risk compatibility (explicit, fail-closed)
// ---------------------------------------------------------------------------

/** Which proposal risk levels an agent risk profile may accept. */
const RISK_MATRIX: Record<Agent['riskLevel'], Agent['riskLevel'][]> = {
  LOW: ['LOW'],
  MEDIUM: ['LOW', 'MEDIUM'],
  HIGH: ['LOW', 'MEDIUM', 'HIGH'],
};

// ---------------------------------------------------------------------------
// Spend ledger repository (persistence seam)
// ---------------------------------------------------------------------------

export interface SpendLedgerRepository {
  /**
   * Atomically create a RESERVED entry keyed by idempotencyKey. Throws
   * ErrorCode.DUPLICATE_PROPOSAL if the key already exists in a non-RESERVED
   * state; returns the existing entry if it is still RESERVED (idempotent
   * replay). This is what makes reservation concurrency-safe.
   */
  reserve(entry: SpendLedgerEntry): Promise<SpendLedgerEntry>;
  /** Mark a reservation COMMITTED (definitive success). */
  commit(idempotencyKey: string): Promise<SpendLedgerEntry>;
  /** Release a reservation back (definitive failure). */
  release(idempotencyKey: string): Promise<SpendLedgerEntry>;
  /** No-op keeping a reservation RESERVED (unknown tx state awaits reconcile). */
  hold(idempotencyKey: string): Promise<SpendLedgerEntry>;
  /** Sum of RESERVED amounts for a session (wei as bigint). */
  reservedTotal(sessionId: string): Promise<bigint>;
  /** Sum of RESERVED + COMMITTED amounts for a session (wei as bigint). */
  reservedAndCommittedTotal(sessionId: string): Promise<bigint>;
  /** Lookup by idempotency key. */
  getByIdempotency(idempotencyKey: string): Promise<SpendLedgerEntry | null>;
}

/** Minimal in-memory ledger for hermetic unit tests and dev. Not for prod. */
export class InMemorySpendLedgerRepository implements SpendLedgerRepository {
  private readonly byKey = new Map<string, SpendLedgerEntry>();

  async reserve(entry: SpendLedgerEntry): Promise<SpendLedgerEntry> {
    const existing = this.byKey.get(entry.idempotencyKey);
    if (existing) {
      if (existing.status !== 'RESERVED') {
        throw new BANError(ErrorCode.DUPLICATE_PROPOSAL, `Reservation ${entry.idempotencyKey} already finalized as ${existing.status}`);
      }
      return existing; // idempotent replay
    }
    this.byKey.set(entry.idempotencyKey, entry);
    return entry;
  }

  async commit(idempotencyKey: string): Promise<SpendLedgerEntry> {
    const entry = this.byKey.get(idempotencyKey);
    if (!entry) throw new BANError(ErrorCode.INTERNAL, `Reservation ${idempotencyKey} not found`);
    const updated: SpendLedgerEntry = { ...entry, status: 'COMMITTED', updatedAt: new Date().toISOString() };
    this.byKey.set(idempotencyKey, updated);
    return updated;
  }

  async release(idempotencyKey: string): Promise<SpendLedgerEntry> {
    const entry = this.byKey.get(idempotencyKey);
    if (!entry) throw new BANError(ErrorCode.INTERNAL, `Reservation ${idempotencyKey} not found`);
    const updated: SpendLedgerEntry = { ...entry, status: 'RELEASED', updatedAt: new Date().toISOString() };
    this.byKey.set(idempotencyKey, updated);
    return updated;
  }

  async hold(idempotencyKey: string): Promise<SpendLedgerEntry> {
    const entry = this.byKey.get(idempotencyKey);
    if (!entry) throw new BANError(ErrorCode.INTERNAL, `Reservation ${idempotencyKey} not found`);
    if (entry.status !== 'RESERVED') return entry;
    const updated: SpendLedgerEntry = { ...entry, updatedAt: new Date().toISOString() };
    this.byKey.set(idempotencyKey, updated);
    return updated;
  }

  async reservedTotal(sessionId: string): Promise<bigint> {
    let total = 0n;
    for (const e of this.byKey.values()) {
      if (e.sessionId === sessionId && e.status === 'RESERVED') total += BigInt(e.amount);
    }
    return total;
  }

  async reservedAndCommittedTotal(sessionId: string): Promise<bigint> {
    let total = 0n;
    for (const e of this.byKey.values()) {
      if (e.sessionId === sessionId && (e.status === 'RESERVED' || e.status === 'COMMITTED')) total += BigInt(e.amount);
    }
    return total;
  }

  async getByIdempotency(idempotencyKey: string): Promise<SpendLedgerEntry | null> {
    return this.byKey.get(idempotencyKey) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Validator hooks (optional — registered by strategies/risk in M9/M20)
// ---------------------------------------------------------------------------

export interface ValidatorResult {
  passed: boolean;
  reason?: string;
}

export type StrategyValidator = (input: {
  proposal: ActionProposal;
  agent: Agent;
  session: Session;
}) => Promise<ValidatorResult>;

export type RiskValidator = (input: {
  proposal: ActionProposal;
  agent: Agent;
}) => Promise<ValidatorResult>;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface PolicyEngineDependencies {
  getAgent(agentId: string): Promise<Agent | null>;
  getSession(sessionId: string): Promise<Session | null>;
  spendLedger: SpendLedgerRepository;
  /** Optional hooks — no strategy/risk validators registered in M5. */
  riskValidator?: RiskValidator;
  strategyValidator?: StrategyValidator;
  logger?: StructuredLogger;
  policyVersion?: string;
}

// ---------------------------------------------------------------------------
// Deterministic Policy Engine
// ---------------------------------------------------------------------------

export class DeterministicPolicyEngine implements PolicyEngineInterface {
  private readonly policyVersion: string;
  private readonly logger: StructuredLogger;

  constructor(private readonly deps: PolicyEngineDependencies) {
    this.policyVersion = deps.policyVersion ?? '1.0.0';
    this.logger = deps.logger ?? createLogger('policy-engine');
  }

  async validateAction(
    proposal: ActionProposal,
    context: { agentId: string; userId: string; sessionId?: string }
  ): Promise<PolicyDecision> {
    const sessionId = context.sessionId ?? proposal.sessionId;
    const base = {
      proposalId: proposal.proposalId,
      sessionId,
      agentId: context.agentId,
      policyVersion: this.policyVersion,
      createdAt: new Date().toISOString(),
    };

    const agent = await this.deps.getAgent(context.agentId);
    const session = await this.deps.getSession(sessionId);

    const checks: PolicyRuleResult[] = [
      this.checkAgentActive(agent),
      this.checkSessionActive(session),
      this.checkCapabilityBound(proposal, agent),
      this.checkProtocolAllowed(proposal, agent, session),
    ];
    if (session) {
      checks.push(
        this.checkContractAllowed(proposal, session),
        this.checkFunctionAllowed(proposal, session),
        this.checkTokenAllowed(proposal, session),
        this.checkPerTransactionCap(proposal, session)
      );
    }
    checks.push(await this.checkCumulativeSpend(proposal, session));
    checks.push(this.checkRiskLevel(proposal, agent));
    checks.push(await this.checkRiskValidator(proposal, agent));
    if (agent && session) {
      checks.push(await this.checkStrategyValidator(proposal, agent, session));
    }

    const failed = checks.find((c) => !c.passed);
    if (failed) {
      const denied: PolicyDecision = {
        ...base,
        decision: 'DENY',
        deniedCheck: failed.check,
        reason: failed.reason ?? `Policy check failed: ${failed.check}`,
        checks,
      };
      this.logger.info('action_denied', { proposalId: proposal.proposalId, sessionId, deniedCheck: failed.check });
      return denied;
    }

    // ---- Allow path: atomically reserve spend before returning ----
    const reservedAt = new Date().toISOString();
    const entry: SpendLedgerEntry = {
      id: `spend_${proposal.proposalId.slice(-24)}`,
      sessionId,
      agentId: context.agentId,
      proposalId: proposal.proposalId,
      executionId: null,
      amount: proposal.estimatedValue,
      asset: proposal.asset,
      status: 'RESERVED',
      idempotencyKey: proposal.idempotencyKey,
      createdAt: reservedAt,
      updatedAt: reservedAt,
    };

    let reservation: SpendLedgerEntry | null = null;
    try {
      reservation = await this.deps.spendLedger.reserve(entry);
    } catch (err) {
      if (err instanceof BANError && err.code === ErrorCode.DUPLICATE_PROPOSAL) {
        const denied: PolicyDecision = {
          ...base,
          decision: 'DENY',
          deniedCheck: 'idempotency',
          reason: 'Duplicate proposal: idempotency key already reserved',
          checks,
        };
        this.logger.warn('action_denied', { proposalId: proposal.proposalId, deniedCheck: 'idempotency' });
        return denied;
      }
      throw err;
    }

    const allowed: PolicyDecision = {
      ...base,
      decision: 'ALLOW',
      checks,
      reservationId: reservation.id,
      reservedAt: reservation.createdAt,
    };
    this.logger.info('action_allowed', {
      proposalId: proposal.proposalId,
      sessionId,
      reservationId: reservation.id,
      idempotencyKey: proposal.idempotencyKey,
    });
    return allowed;
  }

  async validateOrThrow(
    proposal: ActionProposal,
    context: { agentId: string; userId: string; sessionId?: string }
  ): Promise<PolicyDecision> {
    const decision = await this.validateAction(proposal, context);
    if (decision.decision === 'DENY') {
      throw new BANError(ErrorCode.POLICY_DENIED, decision.reason ?? 'Action denied by policy', {
        correlationId: proposal.proposalId,
      });
    }
    return decision;
  }

  // -------------------------------------------------------------------------
  // Individual checks
  // -------------------------------------------------------------------------

  private checkAgentActive(agent: Agent | null): PolicyRuleResult {
    if (!agent) return { check: 'agent-active', passed: false, reason: 'Agent not found' };
    if (agent.status !== 'ACTIVE') return { check: 'agent-active', passed: false, reason: `Agent status is ${agent.status}, expected ACTIVE` };
    return { check: 'agent-active', passed: true };
  }

  private checkSessionActive(session: Session | null): PolicyRuleResult {
    if (!session) return { check: 'session-active', passed: false, reason: 'Session not found' };
    if (session.status === 'REVOKED') return { check: 'session-active', passed: false, reason: 'Session revoked' };
    if (session.status !== 'ACTIVE') return { check: 'session-active', passed: false, reason: `Session status is ${session.status}, expected ACTIVE` };
    if (new Date(session.expiresAt).getTime() <= Date.now()) return { check: 'session-active', passed: false, reason: 'Session expired' };
    return { check: 'session-active', passed: true };
  }

  private checkCapabilityBound(proposal: ActionProposal, agent: Agent | null): PolicyRuleResult {
    if (!agent) return { check: 'capability', passed: false, reason: 'Agent not found' };
    const capId = proposal.capabilityId;
    if (!capId) return { check: 'capability', passed: true };
    const cap = agent.capabilities.find((c) => c.id === capId);
    if (!cap) return { check: 'capability', passed: false, reason: `Capability ${capId} not declared by agent` };
    if (cap.actions && cap.actions.length > 0 && !cap.actions.includes(proposal.action)) {
      return { check: 'capability', passed: false, reason: `Action ${proposal.action} not in capability ${capId}` };
    }
    return { check: 'capability', passed: true };
  }

  private checkProtocolAllowed(proposal: ActionProposal, agent: Agent | null, session: Session | null): PolicyRuleResult {
    if (agent && agent.protocols.length > 0 && !agent.protocols.some((p) => p.toLowerCase() === proposal.protocol.toLowerCase())) {
      return { check: 'protocol-allowed', passed: false, reason: `Protocol ${proposal.protocol} not allowed for agent` };
    }
    if (session && session.allowedContracts.length > 0) {
      const allowed = session.allowedContracts.some((c) => c.toLowerCase() === proposal.contract.toLowerCase());
      if (!allowed) return { check: 'protocol-allowed', passed: false, reason: `Contract ${proposal.contract} not allowed by session` };
    }
    return { check: 'protocol-allowed', passed: true };
  }

  private checkContractAllowed(proposal: ActionProposal, session: Session): PolicyRuleResult {
    if (session.allowedContracts.length === 0) return { check: 'contract-allowed', passed: true };
    const allowed = session.allowedContracts.some((c) => c.toLowerCase() === proposal.contract.toLowerCase());
    if (!allowed) return { check: 'contract-allowed', passed: false, reason: `Contract ${proposal.contract} not in session allowlist` };
    return { check: 'contract-allowed', passed: true };
  }

  private checkFunctionAllowed(proposal: ActionProposal, session: Session): PolicyRuleResult {
    if (session.allowedFunctions.length === 0) return { check: 'function-allowed', passed: true };
    if (!session.allowedFunctions.includes(proposal.function)) {
      return { check: 'function-allowed', passed: false, reason: `Function ${proposal.function} not in session allowlist` };
    }
    return { check: 'function-allowed', passed: true };
  }

  private checkTokenAllowed(proposal: ActionProposal, session: Session): PolicyRuleResult {
    if (session.allowedTokens.length === 0) return { check: 'token-allowed', passed: true };
    if (!session.allowedTokens.some((t) => t.toLowerCase() === proposal.token.toLowerCase())) {
      return { check: 'token-allowed', passed: false, reason: `Token ${proposal.token} not in session allowlist` };
    }
    return { check: 'token-allowed', passed: true };
  }

  private checkPerTransactionCap(proposal: ActionProposal, session: Session): PolicyRuleResult {
    const perTx = BigInt(session.perTransactionCap);
    const value = BigInt(proposal.estimatedValue);
    if (value > perTx) return { check: 'per-transaction-cap', passed: false, reason: `Value ${value} exceeds per-transaction cap ${perTx}` };
    return { check: 'per-transaction-cap', passed: true };
  }

  private async checkCumulativeSpend(proposal: ActionProposal, session: Session | null): Promise<PolicyRuleResult> {
    if (!session) return { check: 'cumulative-spend', passed: false, reason: 'Session not found' };
    const spendCap = BigInt(session.spendCap);
    const requested = BigInt(proposal.estimatedValue);
    const total = await this.deps.spendLedger.reservedAndCommittedTotal(session.sessionId);
    if (total + requested > spendCap) {
      return { check: 'cumulative-spend', passed: false, reason: `Reserved/committed ${total} + ${requested} exceeds cap ${spendCap}` };
    }
    return { check: 'cumulative-spend', passed: true };
  }

  private checkRiskLevel(proposal: ActionProposal, agent: Agent | null): PolicyRuleResult {
    if (!agent) return { check: 'risk-level', passed: false, reason: 'Agent not found' };
    const proposalRisk = proposal.riskLevel;
    if (!proposalRisk) return { check: 'risk-level', passed: false, reason: 'Missing proposal risk level (fail closed)' };
    if (!RISK_MATRIX[agent.riskLevel].includes(proposalRisk)) {
      return { check: 'risk-level', passed: false, reason: `Risk ${proposalRisk} incompatible with agent risk ${agent.riskLevel}` };
    }
    return { check: 'risk-level', passed: true };
  }

  private async checkRiskValidator(proposal: ActionProposal, agent: Agent | null): Promise<PolicyRuleResult> {
    if (!this.deps.riskValidator) return { check: 'risk-validator', passed: true };
    if (!agent) return { check: 'risk-validator', passed: false, reason: 'Agent not found' };
    const res = await this.deps.riskValidator({ proposal, agent });
    if (!res.passed) return { check: 'risk-validator', passed: false, reason: res.reason ?? 'Risk validator rejected' };
    return { check: 'risk-validator', passed: true };
  }

  private async checkStrategyValidator(
    proposal: ActionProposal,
    agent: Agent,
    session: Session
  ): Promise<PolicyRuleResult> {
    if (!this.deps.strategyValidator) return { check: 'strategy-validator', passed: true };
    const res = await this.deps.strategyValidator({ proposal, agent, session });
    if (!res.passed) return { check: 'strategy-validator', passed: false, reason: res.reason ?? 'Strategy validator rejected' };
    return { check: 'strategy-validator', passed: true };
  }
}