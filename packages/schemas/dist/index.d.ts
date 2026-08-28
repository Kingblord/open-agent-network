import { z } from 'zod';
/**
 * BAN shared domain schemas (runtime-agnostic, no Next.js/Firebase dep).
 *
 * Source of truth for the core entities across milestones: agents (registry),
 * jobs (durable executor), sessions (Altana wallet scoping), and the
 * policy/execution plane (proposals, decisions, spend ledger, executions,
 * positions, performance, audit). All consumers (apps/web control plane,
 * strategy packages, workers) import from here so identity/lifecycle enums are
 * never duplicated as brittle string literals.
 */
/** EVM-compatible address (loose — not all BAN surfaces are strictly EIP-55). */
export declare const AddressSchema: z.ZodString;
export type Address = z.infer<typeof AddressSchema>;
/** ISO-8601 timestamp string. */
export declare const ISO8601Schema: z.ZodString;
export type ISO8601 = z.infer<typeof ISO8601Schema>;
/** Selected action types a policy/executor can act on. */
export declare const ActionTypeSchema: z.ZodEnum<{
    SWAP: "SWAP";
    TRANSFER: "TRANSFER";
    DEPOSIT: "DEPOSIT";
    WITHDRAW: "WITHDRAW";
    STAKE: "STAKE";
    UNSTAKE: "UNSTAKE";
    MINT: "MINT";
    BURN: "BURN";
    APPROVE: "APPROVE";
    REBALANCE: "REBALANCE";
    CUSTOM: "CUSTOM";
}>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export declare const AgentStatusSchema: z.ZodEnum<{
    DRAFT: "DRAFT";
    ACTIVE: "ACTIVE";
    PAUSED: "PAUSED";
    REVOKED: "REVOKED";
    EXPIRED: "EXPIRED";
    ERROR: "ERROR";
}>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export declare const CapabilitySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    actions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        SWAP: "SWAP";
        TRANSFER: "TRANSFER";
        DEPOSIT: "DEPOSIT";
        WITHDRAW: "WITHDRAW";
        STAKE: "STAKE";
        UNSTAKE: "UNSTAKE";
        MINT: "MINT";
        BURN: "BURN";
        APPROVE: "APPROVE";
        REBALANCE: "REBALANCE";
        CUSTOM: "CUSTOM";
    }>>>;
}, z.core.$strip>;
export type Capability = z.infer<typeof CapabilitySchema>;
/**
 * Authoritative agent record. Owned by the BAN Agent Registry (`agents`
 * collection). `type` / `strategyId` are opaque references — the registry
 * never knows strategy-specific internals. `riskLevel` is the agent's risk
 * profile (LOW/MEDIUM/HIGH) used by the policy engine.
 */
export declare const AgentSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    ownerId: z.ZodString;
    type: z.ZodString;
    strategyId: z.ZodOptional<z.ZodString>;
    walletAddress: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        DRAFT: "DRAFT";
        ACTIVE: "ACTIVE";
        PAUSED: "PAUSED";
        REVOKED: "REVOKED";
        EXPIRED: "EXPIRED";
        ERROR: "ERROR";
    }>;
    capabilities: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        actions: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            SWAP: "SWAP";
            TRANSFER: "TRANSFER";
            DEPOSIT: "DEPOSIT";
            WITHDRAW: "WITHDRAW";
            STAKE: "STAKE";
            UNSTAKE: "UNSTAKE";
            MINT: "MINT";
            BURN: "BURN";
            APPROVE: "APPROVE";
            REBALANCE: "REBALANCE";
            CUSTOM: "CUSTOM";
        }>>>;
    }, z.core.$strip>>;
    protocols: z.ZodArray<z.ZodString>;
    riskLevel: z.ZodEnum<{
        LOW: "LOW";
        MEDIUM: "MEDIUM";
        HIGH: "HIGH";
    }>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type Agent = z.infer<typeof AgentSchema>;
export declare const JobTypeSchema: z.ZodEnum<{
    "agent-observation": "agent-observation";
    "agent-decision": "agent-decision";
    "agent-execution": "agent-execution";
    "market-data": "market-data";
    "position-sync": "position-sync";
    performance: "performance";
    notifications: "notifications";
}>;
export type JobType = z.infer<typeof JobTypeSchema>;
export declare const JobStatusSchema: z.ZodEnum<{
    QUEUED: "QUEUED";
    RUNNING: "RUNNING";
    SUCCEEDED: "SUCCEEDED";
    FAILED: "FAILED";
    DEAD_LETTER: "DEAD_LETTER";
    CANCELLED: "CANCELLED";
}>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export declare const JobSchema: z.ZodObject<{
    jobId: z.ZodString;
    jobType: z.ZodEnum<{
        "agent-observation": "agent-observation";
        "agent-decision": "agent-decision";
        "agent-execution": "agent-execution";
        "market-data": "market-data";
        "position-sync": "position-sync";
        performance: "performance";
        notifications: "notifications";
    }>;
    agentId: z.ZodString;
    userId: z.ZodString;
    correlationId: z.ZodString;
    idempotencyKey: z.ZodString;
    attempt: z.ZodNumber;
    createdAt: z.ZodString;
    scheduledAt: z.ZodString;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    status: z.ZodOptional<z.ZodEnum<{
        QUEUED: "QUEUED";
        RUNNING: "RUNNING";
        SUCCEEDED: "SUCCEEDED";
        FAILED: "FAILED";
        DEAD_LETTER: "DEAD_LETTER";
        CANCELLED: "CANCELLED";
    }>>;
    lastError: z.ZodOptional<z.ZodObject<{
        code: z.ZodOptional<z.ZodString>;
        message: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Job = z.infer<typeof JobSchema>;
export declare const SessionStatusSchema: z.ZodEnum<{
    ACTIVE: "ACTIVE";
    REVOKED: "REVOKED";
    EXPIRED: "EXPIRED";
    PENDING: "PENDING";
    EXPIRING: "EXPIRING";
}>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export declare const SessionSchema: z.ZodObject<{
    sessionId: z.ZodString;
    agentId: z.ZodString;
    walletAddress: z.ZodString;
    sessionKeyReference: z.ZodString;
    allowedContracts: z.ZodArray<z.ZodString>;
    allowedFunctions: z.ZodArray<z.ZodString>;
    allowedTokens: z.ZodArray<z.ZodString>;
    spendCap: z.ZodString;
    perTransactionCap: z.ZodString;
    expiresAt: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        ACTIVE: "ACTIVE";
        REVOKED: "REVOKED";
        EXPIRED: "EXPIRED";
        PENDING: "PENDING";
        EXPIRING: "EXPIRING";
    }>>;
    onchainRegistryReference: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type Session = z.infer<typeof SessionSchema>;
export declare const PermissionSchema: z.ZodObject<{
    id: z.ZodString;
    agentId: z.ZodString;
    protocol: z.ZodOptional<z.ZodString>;
    contract: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodEnum<{
        SWAP: "SWAP";
        TRANSFER: "TRANSFER";
        DEPOSIT: "DEPOSIT";
        WITHDRAW: "WITHDRAW";
        STAKE: "STAKE";
        UNSTAKE: "UNSTAKE";
        MINT: "MINT";
        BURN: "BURN";
        APPROVE: "APPROVE";
        REBALANCE: "REBALANCE";
        CUSTOM: "CUSTOM";
    }>>;
    functions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    creditedToken: z.ZodOptional<z.ZodString>;
    amount: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type Permission = z.infer<typeof PermissionSchema>;
/**
 * A proposed onchain action from a strategy/decision layer. This is the input
 * unit to the PolicyEngine. `estimatedValue` is the pessimistic worst-case
 * spend in wei (source wei, not slippage-adjusted).
 */
export declare const ActionProposalSchema: z.ZodObject<{
    proposalId: z.ZodString;
    agentId: z.ZodString;
    userId: z.ZodString;
    strategyId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodString;
    protocol: z.ZodString;
    contract: z.ZodString;
    function: z.ZodString;
    action: z.ZodEnum<{
        SWAP: "SWAP";
        TRANSFER: "TRANSFER";
        DEPOSIT: "DEPOSIT";
        WITHDRAW: "WITHDRAW";
        STAKE: "STAKE";
        UNSTAKE: "UNSTAKE";
        MINT: "MINT";
        BURN: "BURN";
        APPROVE: "APPROVE";
        REBALANCE: "REBALANCE";
        CUSTOM: "CUSTOM";
    }>;
    capabilityId: z.ZodOptional<z.ZodString>;
    token: z.ZodString;
    amount: z.ZodString;
    estimatedValue: z.ZodString;
    asset: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    idempotencyKey: z.ZodString;
    nonce: z.ZodOptional<z.ZodString>;
    riskLevel: z.ZodOptional<z.ZodEnum<{
        LOW: "LOW";
        MEDIUM: "MEDIUM";
        HIGH: "HIGH";
    }>>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export declare const PolicyDecisionValueSchema: z.ZodEnum<{
    ALLOW: "ALLOW";
    DENY: "DENY";
}>;
export type PolicyDecisionValue = z.infer<typeof PolicyDecisionValueSchema>;
export declare const PolicyRuleResultSchema: z.ZodObject<{
    check: z.ZodString;
    passed: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type PolicyRuleResult = z.infer<typeof PolicyRuleResultSchema>;
/** Complete, auditable output of a policy evaluation. */
export declare const PolicyDecisionSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        ALLOW: "ALLOW";
        DENY: "DENY";
    }>;
    proposalId: z.ZodString;
    sessionId: z.ZodString;
    agentId: z.ZodString;
    policyVersion: z.ZodString;
    checks: z.ZodArray<z.ZodObject<{
        check: z.ZodString;
        passed: z.ZodBoolean;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    deniedCheck: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    reservationId: z.ZodOptional<z.ZodString>;
    reservedAt: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export declare const SpendReservationStatusSchema: z.ZodEnum<{
    RESERVED: "RESERVED";
    COMMITTED: "COMMITTED";
    RELEASED: "RELEASED";
}>;
export type SpendReservationStatus = z.infer<typeof SpendReservationStatusSchema>;
export declare const SpendLedgerEntrySchema: z.ZodObject<{
    id: z.ZodString;
    sessionId: z.ZodString;
    agentId: z.ZodString;
    proposalId: z.ZodString;
    executionId: z.ZodNullable<z.ZodString>;
    amount: z.ZodString;
    asset: z.ZodString;
    status: z.ZodEnum<{
        RESERVED: "RESERVED";
        COMMITTED: "COMMITTED";
        RELEASED: "RELEASED";
    }>;
    idempotencyKey: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type SpendLedgerEntry = z.infer<typeof SpendLedgerEntrySchema>;
export declare const ExecutionStatusSchema: z.ZodEnum<{
    QUEUED: "QUEUED";
    FAILED: "FAILED";
    CANCELLED: "CANCELLED";
    PROPOSED: "PROPOSED";
    VALIDATING: "VALIDATING";
    REJECTED: "REJECTED";
    EXECUTING: "EXECUTING";
    CONFIRMING: "CONFIRMING";
    CONFIRMED: "CONFIRMED";
}>;
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export declare const ExecutionSchema: z.ZodObject<{
    executionId: z.ZodString;
    proposalId: z.ZodString;
    agentId: z.ZodString;
    userId: z.ZodString;
    protocol: z.ZodString;
    contract: z.ZodString;
    function: z.ZodString;
    parametersHash: z.ZodString;
    transactionHash: z.ZodNullable<z.ZodString>;
    chainId: z.ZodNumber;
    gasUsed: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        QUEUED: "QUEUED";
        FAILED: "FAILED";
        CANCELLED: "CANCELLED";
        PROPOSED: "PROPOSED";
        VALIDATING: "VALIDATING";
        REJECTED: "REJECTED";
        EXECUTING: "EXECUTING";
        CONFIRMING: "CONFIRMING";
        CONFIRMED: "CONFIRMED";
    }>;
    errorCode: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    confirmedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type Execution = z.infer<typeof ExecutionSchema>;
export declare const PositionSchema: z.ZodObject<{
    positionId: z.ZodString;
    agentId: z.ZodString;
    protocol: z.ZodString;
    contract: z.ZodString;
    asset: z.ZodString;
    amount: z.ZodString;
    entryValueUsd: z.ZodString;
    currentValueUsd: z.ZodString;
    openedAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type Position = z.infer<typeof PositionSchema>;
export declare const PerformanceSchema: z.ZodObject<{
    performanceId: z.ZodString;
    agentId: z.ZodString;
    startAt: z.ZodString;
    realizedPnlUsd: z.ZodString;
    unrealizedPnlUsd: z.ZodString;
    totalTrades: z.ZodNumber;
    winRate: z.ZodString;
    maxDrawdownUsd: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type Performance = z.infer<typeof PerformanceSchema>;
export declare const AuditEventSchema: z.ZodObject<{
    eventId: z.ZodString;
    type: z.ZodString;
    severity: z.ZodDefault<z.ZodEnum<{
        ERROR: "ERROR";
        INFO: "INFO";
        WARN: "WARN";
        CRITICAL: "CRITICAL";
    }>>;
    correlationId: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
    userId: z.ZodOptional<z.ZodString>;
    proposalId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    executionId: z.ZodOptional<z.ZodString>;
    policyVersion: z.ZodOptional<z.ZodString>;
    checks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        check: z.ZodString;
        passed: z.ZodBoolean;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    detail: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export declare const ToolCapabilitySchema: z.ZodEnum<{
    READ_BALANCE: "READ_BALANCE";
    READ_PRICE: "READ_PRICE";
    READ_YIELD: "READ_YIELD";
    READ_LENDING_POSITION: "READ_LENDING_POSITION";
    READ_LP_POSITION: "READ_LP_POSITION";
    PROPOSE_SWAP: "PROPOSE_SWAP";
    PROPOSE_LP_REBALANCE: "PROPOSE_LP_REBALANCE";
    PROPOSE_LENDING_ACTION: "PROPOSE_LENDING_ACTION";
    PROPOSE_GRID_ORDER: "PROPOSE_GRID_ORDER";
}>;
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;
/** A registered tool the AI may invoke. `capabilityId` is the ONLY window into
 *  the tool — the AI cannot invent a tool name; it must be registered here with
 *  an explicit, canonical capability it requires. */
export declare const ToolDefinitionSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    capabilityId: z.ZodEnum<{
        READ_BALANCE: "READ_BALANCE";
        READ_PRICE: "READ_PRICE";
        READ_YIELD: "READ_YIELD";
        READ_LENDING_POSITION: "READ_LENDING_POSITION";
        READ_LP_POSITION: "READ_LP_POSITION";
        PROPOSE_SWAP: "PROPOSE_SWAP";
        PROPOSE_LP_REBALANCE: "PROPOSE_LP_REBALANCE";
        PROPOSE_LENDING_ACTION: "PROPOSE_LENDING_ACTION";
        PROPOSE_GRID_ORDER: "PROPOSE_GRID_ORDER";
    }>;
    input: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
/** Structured, capability-validated tool result. Never a raw RPC blob, never a
 *  private key, never an arbitrary contract call. */
export declare const ToolResultSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    tool: z.ZodString;
    output: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
    timestamp: z.ZodString;
}, z.core.$strip>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export declare const ToolCallSchema: z.ZodObject<{
    tool: z.ZodString;
    input: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    correlationId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export declare const ToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    parameters: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type Tool = z.infer<typeof ToolSchema>;
export declare const ObservationSchema: z.ZodObject<{
    id: z.ZodString;
    agentId: z.ZodString;
    type: z.ZodString;
    data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    observedAt: z.ZodString;
}, z.core.$strip>;
export type Observation = z.infer<typeof ObservationSchema>;
export declare const StrategyDecisionStatusSchema: z.ZodEnum<{
    PASS: "PASS";
    ACT: "ACT";
}>;
export type StrategyDecisionStatus = z.infer<typeof StrategyDecisionStatusSchema>;
/**
 * Strict, re-validated output envelope of the AI brain.
 * - `status: 'PASS'` → the AI chose to take no action (reason required when
 *   the agent was expected to act but declined).
 * - `status: 'ACT'` → a fully-formed, validated `proposal` ready for the
 *   policy engine. The proposal must already satisfy `ActionProposalSchema`
 *   AND be backed by one of the agent's granted capabilities.
 */
export declare const StrategyDecisionSchema: z.ZodObject<{
    decisionId: z.ZodString;
    agentId: z.ZodString;
    strategyId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        PASS: "PASS";
        ACT: "ACT";
    }>;
    proposal: z.ZodOptional<z.ZodObject<{
        proposalId: z.ZodString;
        agentId: z.ZodString;
        userId: z.ZodString;
        strategyId: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodString;
        protocol: z.ZodString;
        contract: z.ZodString;
        function: z.ZodString;
        action: z.ZodEnum<{
            SWAP: "SWAP";
            TRANSFER: "TRANSFER";
            DEPOSIT: "DEPOSIT";
            WITHDRAW: "WITHDRAW";
            STAKE: "STAKE";
            UNSTAKE: "UNSTAKE";
            MINT: "MINT";
            BURN: "BURN";
            APPROVE: "APPROVE";
            REBALANCE: "REBALANCE";
            CUSTOM: "CUSTOM";
        }>;
        capabilityId: z.ZodOptional<z.ZodString>;
        token: z.ZodString;
        amount: z.ZodString;
        estimatedValue: z.ZodString;
        asset: z.ZodString;
        params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        idempotencyKey: z.ZodString;
        nonce: z.ZodOptional<z.ZodString>;
        riskLevel: z.ZodOptional<z.ZodEnum<{
            LOW: "LOW";
            MEDIUM: "MEDIUM";
            HIGH: "HIGH";
        }>>;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    observations: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        agentId: z.ZodString;
        type: z.ZodString;
        data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        observedAt: z.ZodString;
    }, z.core.$strip>>>;
    deniedReason: z.ZodOptional<z.ZodString>;
    reasoning: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type StrategyDecision = z.infer<typeof StrategyDecisionSchema>;
//# sourceMappingURL=index.d.ts.map