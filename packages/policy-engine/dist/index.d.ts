import type { ActionProposal, Agent, PolicyDecision, Session, SpendLedgerEntry } from '@ban/schemas';
import { type StructuredLogger } from '@ban/shared';
import type { PolicyEngine as PolicyEngineInterface } from '@ban/agent-core';
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
export declare class InMemorySpendLedgerRepository implements SpendLedgerRepository {
    private readonly byKey;
    reserve(entry: SpendLedgerEntry): Promise<SpendLedgerEntry>;
    commit(idempotencyKey: string): Promise<SpendLedgerEntry>;
    release(idempotencyKey: string): Promise<SpendLedgerEntry>;
    hold(idempotencyKey: string): Promise<SpendLedgerEntry>;
    reservedTotal(sessionId: string): Promise<bigint>;
    reservedAndCommittedTotal(sessionId: string): Promise<bigint>;
    getByIdempotency(idempotencyKey: string): Promise<SpendLedgerEntry | null>;
}
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
export declare class DeterministicPolicyEngine implements PolicyEngineInterface {
    private readonly deps;
    private readonly policyVersion;
    private readonly logger;
    constructor(deps: PolicyEngineDependencies);
    validateAction(proposal: ActionProposal, context: {
        agentId: string;
        userId: string;
        sessionId?: string;
    }): Promise<PolicyDecision>;
    validateOrThrow(proposal: ActionProposal, context: {
        agentId: string;
        userId: string;
        sessionId?: string;
    }): Promise<PolicyDecision>;
    private checkAgentActive;
    private checkSessionActive;
    private checkCapabilityBound;
    private checkProtocolAllowed;
    private checkContractAllowed;
    private checkFunctionAllowed;
    private checkTokenAllowed;
    private checkPerTransactionCap;
    private checkCumulativeSpend;
    private checkRiskLevel;
    private checkRiskValidator;
    private checkStrategyValidator;
}
//# sourceMappingURL=index.d.ts.map