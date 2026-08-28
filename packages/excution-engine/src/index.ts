import type { ActionProposal, Execution, Session } from '@ban/schemas';
import type { ExecutionEngine as ExecutionEngineInterface } from '@ban/agent-core';
import { BANError, ErrorCode, createLogger } from '@ban/shared';

/**
 * Generic Execution Engine (Milestone 8).
 *
 * The ONLY component allowed to cross the trust boundary into blockchain
 * transaction authority, and only via a valid scoped Altana session.
 *
 * Pipeline:
 *   proposal -> persist PROPOSED -> idempotency gate -> preflight ->
 *   session ACTIVE gate -> queue/submit via session -> receipt ->
 *   reconcile -> persist CONFIRMED/FAILED
 *
 * Safety boundaries:
 *   - The AI is never in this loop. The policy engine (M5) decides whether an
 *     action is permitted; this engine deterministically executes what BAN has
 *     already authorized.
 *   - `preflightProposal` is optional and injected. If configured, a DENY aborts
 *     execution BEFORE submit — no transaction is broadcast. If NOT configured,
 *     execution is allowed (framework-level unit path) but the absence is made
 *     explicit in the logs/result rather than pretending a simulation occurred.
 *   - Execution idempotency is enforced at the top of `execute()`: if an
 *     execution already exists for the derived executionId, we NEVER broadcast a
 *     second transaction. Existing EXECUTING/CONFIRMING executions are reconciled
 *     from their recorded transactionHash; CONFIRMED is a no-op; PROPOSED is
 *     recovered (a not-yet-submitted execution may proceed); FAILED is refused
 *     unless an explicit retry policy authorizes a retry (not enabled by default).
 *   - `parametersHash` is deterministically derived from `proposal.params` (the
 *     canonical ActionProposal field).
 *
 * Chain: BAN execution chain is BNB Smart Chain MAINNET (chainId 56). The
 * default below is 56; a testnet override (`BAN_CHAIN_ID=97`) is only honored
 * by explicitly configuring the env. The engine never fabricates a chain.
 */

export interface ExecutionContext {
  agentId: string;
  userId: string;
  correlationId: string;
  session: Session;
}

/** Deterministic preflight/simulation gate (injected — lives outside M8 core). */
export interface PreflightSimulation {
  simulate(proposal: ActionProposal, context: ExecutionContext): Promise<{ approved: boolean; reason?: string }>;
}

export interface ExecutionEngineDependencies {
  persistExecution(execution: Execution): Promise<void>;
  getExecution(executionId: string): Promise<Execution | null>;
  /** Deterministic submission through the agent session/wallet layer. */
  submitTransaction(input: {
    proposal: ActionProposal;
    session: Session;
    correlationId: string;
  }): Promise<{ transactionHash: string; gasUsed?: string }>;
  reconcileExecution(input: { executionId: string; transactionHash: string }): Promise<{ status: Execution['status']; errorCode?: string | null }>;
  /** Optional preflight simulation. Absence = framework-level unit path (logged, never silently claimed). */
  preflight?: PreflightSimulation;
}

function executionIdFrom(proposalId: string): string {
  return `exec_${proposalId.slice(-24)}`;
}

/** BAN execution chain = BNB Smart Chain mainnet. Override only via BAN_CHAIN_ID. */
export const BAN_CHAIN_ID_DEFAULT = 56;

function currentChainId(): number {
  const raw = process.env.BAN_CHAIN_ID;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw);
    // Only allow a well-formed numeric override (testnet 97 or mainnet 56).
    if (Number.isInteger(parsed) && (parsed === 56 || parsed === 97)) return parsed;
  }
  return BAN_CHAIN_ID_DEFAULT;
}

export class GenericExecutionEngine implements ExecutionEngineInterface {
  private readonly logger = createLogger('execution-engine');

  constructor(private readonly deps: ExecutionEngineDependencies) {}

  async execute(proposal: ActionProposal, context: ExecutionContext): Promise<Execution> {
    const executionId = executionIdFrom(proposal.proposalId);
    const createdAt = new Date().toISOString();

    // ------------------------------------------------------------------
    // 1) Idempotency / crash-recovery gate (BEFORE any submit)
    // ------------------------------------------------------------------
    const existing = await this.deps.getExecution(executionId);
    if (existing) {
      const recovered = await this.handleExisting(existing, proposal, context);
      if (recovered) return recovered;
    }

    const execution: Execution = {
      executionId,
      proposalId: proposal.proposalId,
      agentId: context.agentId,
      userId: context.userId,
      protocol: proposal.protocol,
      contract: proposal.contract,
      function: proposal.function,
      parametersHash: JSON.stringify(proposal.params ?? {}),
      transactionHash: null,
      chainId: currentChainId(), // BNB mainnet (56) by default
      gasUsed: null,
      status: 'PROPOSED',
      errorCode: null,
      createdAt,
      confirmedAt: null,
    };

    await this.deps.persistExecution(execution);
    this.logger.info('execution_created', { executionId, proposalId: proposal.proposalId, correlationId: context.correlationId });

    // ------------------------------------------------------------------
    // 2) Session validity (final safety gate before authority crosses)
    // ------------------------------------------------------------------
    if (context.session.status !== 'ACTIVE') {
      const failed: Execution = { ...execution, status: 'FAILED', errorCode: ErrorCode.SESSION_REVOKED };
      await this.deps.persistExecution(failed);
      throw new BANError(ErrorCode.SESSION_REVOKED, `Session ${context.session.sessionId} is not ACTIVE`, { correlationId: context.correlationId });
    }

    // ------------------------------------------------------------------
    // 3) Optional preflight simulation — aborts BEFORE submit when denied
    // ------------------------------------------------------------------
    if (this.deps.preflight) {
      const result = await this.deps.preflight.simulate(proposal, context);
      if (!result.approved) {
        const failed: Execution = { ...execution, status: 'FAILED', errorCode: ErrorCode.POLICY_DENIED };
        await this.deps.persistExecution(failed);
        this.logger.error('execution_preflight_denied', { executionId, reason: result.reason ?? 'preflight rejected', correlationId: context.correlationId });
        throw new BANError(ErrorCode.POLICY_DENIED, result.reason ?? 'Preflight simulation rejected the proposal', { correlationId: context.correlationId });
      }
    } else {
      // No preflight configured — allow the framework unit path, but be explicit.
      this.logger.warn('execution_preflight_not_configured', { executionId, correlationId: context.correlationId, note: 'simulation was NOT performed' });
    }

    // ------------------------------------------------------------------
    // 4) Mark EXECUTING and submit (the ONLY broadcast point)
    // ------------------------------------------------------------------
    const submitting: Execution = { ...execution, status: 'EXECUTING' };
    await this.deps.persistExecution(submitting);

    try {
      const submitted = await this.deps.submitTransaction({
        proposal,
        session: context.session,
        correlationId: context.correlationId,
      });

      const confirming: Execution = {
        ...submitting,
        transactionHash: submitted.transactionHash,
        gasUsed: submitted.gasUsed ?? null,
        status: 'CONFIRMING',
      };
      await this.deps.persistExecution(confirming);

      // ------------------------------------------------------------------
      // 5) Reconciliation + terminal persist
      // ------------------------------------------------------------------
      const reconciled = await this.deps.reconcileExecution({
        executionId,
        transactionHash: submitted.transactionHash,
      });

      const final: Execution = {
        ...confirming,
        status: reconciled.status,
        errorCode: reconciled.errorCode ?? null,
        confirmedAt: reconciled.status === 'CONFIRMED' ? new Date().toISOString() : null,
      };
      await this.deps.persistExecution(final);
      this.logger.info('execution_finished', {
        executionId,
        status: final.status,
        transactionHash: final.transactionHash ?? undefined,
        correlationId: context.correlationId,
      });
      return final;
    } catch (err) {
      const failed: Execution = {
        ...execution,
        status: 'FAILED',
        errorCode: err instanceof BANError ? err.code : ErrorCode.EXECUTION_FAILED,
      };
      await this.deps.persistExecution(failed);
      this.logger.error('execution_failed', { executionId, correlationId: context.correlationId }, err);
      throw err;
    }
  }

  /**
   * Recovery / idempotency for an existing execution identity. Returns an
   * Execution when the request should terminate (no new broadcast), or `null`
   * when the request may proceed to the execution pipeline.
   */
  private async handleExisting(existing: Execution, proposal: ActionProposal, context: ExecutionContext): Promise<Execution | null> {
    const { executionId, transactionHash } = existing;

    // CONFIRMED -> idempotent success / no-op (never rebroadcast).
    if (existing.status === 'CONFIRMED') {
      this.logger.info('execution_idempotent_noop', { executionId, correlationId: context.correlationId });
      return existing;
    }

    // EXECUTING / CONFIRMING: a tx may or may not have reached the chain.
    // The crash-recovery rule: we cannot assume submission failed. If a hash is
    // recorded, reconcile it. If not, submission state is unknown -> refuse.
    if (existing.status === 'EXECUTING' || existing.status === 'CONFIRMING') {
      if (transactionHash) {
        this.logger.warn('execution_reconciling_existing', { executionId, transactionHash, correlationId: context.correlationId });
        return this.reconcile(executionId);
      }
      throw new BANError(ErrorCode.DUPLICATE_PROPOSAL, `Execution ${executionId} is ${existing.status} with unknown submission state; refusing to rebroadcast`, { correlationId: context.correlationId });
    }

    // PROPOSED: created but never submitted — safe to recover/continue (submit once).
    if (existing.status === 'PROPOSED') {
      this.logger.info('execution_recovered_proposed', { executionId, correlationId: context.correlationId });
      return null;
    }

    // FAILED: only retry under an explicit retry policy. Not enabled by default.
    if (existing.status === 'FAILED') {
      throw new BANError(ErrorCode.DUPLICATE_PROPOSAL, `Execution ${executionId} previously FAILED; retry requires an explicit retry policy`, { correlationId: context.correlationId });
    }

    // REJECTED / VALIDATING / QUEUED / CANCELLED: not a fresh-executable state here.
    throw new BANError(ErrorCode.DUPLICATE_PROPOSAL, `Execution ${executionId} is in ${existing.status}; cannot execute again`, { correlationId: context.correlationId });
  }

  async reconcile(executionId: string): Promise<Execution> {
    const execution = await this.deps.getExecution(executionId);
    if (!execution) {
      throw new BANError(ErrorCode.INTERNAL, `Execution ${executionId} not found`);
    }
    if (!execution.transactionHash) {
      throw new BANError(ErrorCode.EXECUTION_FAILED, 'Cannot reconcile execution without a transaction hash');
    }
    const reconciled = await this.deps.reconcileExecution({
      executionId,
      transactionHash: execution.transactionHash,
    });
    const updated: Execution = {
      ...execution,
      status: reconciled.status,
      errorCode: reconciled.errorCode ?? null,
      confirmedAt: reconciled.status === 'CONFIRMED' ? new Date().toISOString() : execution.confirmedAt,
    };
    await this.deps.persistExecution(updated);
    return updated;
  }
}