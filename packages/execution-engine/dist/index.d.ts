import type { ActionProposal, Execution, Session } from '@ban/schemas';
import type { ExecutionEngine as ExecutionEngineInterface } from '@ban/agent-core';
/**
 * Generic Execution Engine (Milestone 8).
 *
 * The ONLY component allowed to cross the trust boundary into blockchain
 * transaction authority, and only via a valid scoped Altana session.
 *
 * Pipeline:
 *   proposal -> persist PROPOSED -> idempotency gate -> preflight ->
 *   session ACTIVE gate -> EIP-7702 authorization gate (when required) ->
 *   queue/submit via session -> receipt -> reconcile -> persist CONFIRMED/FAILED
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
 *   - `parametersHash` is deterministically derived from
 *     `proposal.parameters ?? proposal.params` (update-v3 §21/§29: `parameters`
 *     is the canonical alias; `params` retained compat).
 *   - EIP-7702 authorization gate (update-v3 §10/§12): when the job is flagged
 *     `requiresUserFunds`, execution REQUIRES a resolved EIP7702/ACTIVE
 *     authorization from the injected `authorization` provider. Absence of the
 *     provider OR a non-ACTIVE resolution FAILS CLOSED (POLICY_DENIED) before
 *     anything is submitted. Operational jobs (Altana default) bypass the gate.
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
    /** update-v3 §10: job context so the engine knows when EIP-7702 is required. */
    job?: {
        jobId: string;
        requiresUserFunds?: boolean;
        authorizationRef?: {
            permissionId?: string;
            status?: string;
        };
    };
}
/** Deterministic preflight/simulation gate (injected — lives outside M8 core). */
export interface PreflightSimulation {
    simulate(proposal: ActionProposal, context: ExecutionContext): Promise<{
        approved: boolean;
        reason?: string;
    }>;
}
/**
 * EIP-7702 authorization seam (update-v3 §12) — structural interface only, so
 * packages stay build-order-independent. The concrete provider is wired in
 * apps/web (@ban/eip7702 + Firestore) and must resolve jobs that touch
 * USER-OWNED funds to an ACTIVE EIP7702 permission.
 */
export interface ExecutionAuthorizationResolution {
    mode: 'ALTANA' | 'EIP7702';
    permissionId?: string;
    permissionStatus?: string;
}
export interface ExecutionAuthorization {
    resolve(proposal: ActionProposal, context: ExecutionContext): Promise<ExecutionAuthorizationResolution>;
}
export interface ExecutionEngineDependencies {
    persistExecution(execution: Execution): Promise<void>;
    getExecution(executionId: string): Promise<Execution | null>;
    /** Deterministic submission through the agent session/wallet layer. */
    submitTransaction(input: {
        proposal: ActionProposal;
        session: Session;
        correlationId: string;
    }): Promise<{
        transactionHash: string;
        gasUsed?: string;
    }>;
    reconcileExecution(input: {
        executionId: string;
        transactionHash: string;
    }): Promise<{
        status: Execution['status'];
        errorCode?: string | null;
    }>;
    /** Optional preflight simulation. Absence = framework-level unit path (logged, never silently claimed). */
    preflight?: PreflightSimulation;
    /** Optional EIP-7702 authorization gate for user-funds jobs (update-v3 §12). */
    authorization?: ExecutionAuthorization;
}
/** BAN execution chain = BNB Smart Chain mainnet. Override only via BAN_CHAIN_ID. */
export declare const BAN_CHAIN_ID_DEFAULT = 56;
export declare class GenericExecutionEngine implements ExecutionEngineInterface {
    private readonly deps;
    private readonly logger;
    constructor(deps: ExecutionEngineDependencies);
    execute(proposal: ActionProposal, context: ExecutionContext): Promise<Execution>;
    /**
     * Recovery / idempotency for an existing execution identity. Returns an
     * Execution when the request should terminate (no new broadcast), or `null`
     * when the request may proceed to the execution pipeline.
     */
    private handleExisting;
    reconcile(executionId: string): Promise<Execution>;
}
//# sourceMappingURL=index.d.ts.map