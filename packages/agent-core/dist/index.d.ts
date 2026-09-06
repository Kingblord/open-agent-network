import type { Agent, Session, Permission, Tool, Observation, ActionProposal, Execution, Position, Performance, AuditEvent, PolicyDecision, StrategyDecision } from '@ban/schemas';
/**
 * BAN Core stable interfaces.
 *
 * Strategy implementations depend on these interfaces — never on Firebase,
 * Altana, or individual protocol SDK details directly.
 */
export interface AgentRegistry {
    createAgent(input: Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<Agent>;
    getAgent(id: string): Promise<Agent | null>;
    updateAgent(id: string, patch: Partial<Agent>): Promise<Agent>;
    pauseAgent(id: string): Promise<Agent>;
    activateAgent(id: string): Promise<Agent>;
    revokeAgent(id: string): Promise<Agent>;
    listAgents(ownerId: string): Promise<Agent[]>;
}
export interface SessionManager {
    requestSession(input: {
        agentId: string;
        walletAddress: string;
        allowedContracts: string[];
        allowedFunctions: string[];
        allowedTokens: string[];
        spendCap: string;
        perTransactionCap: string;
        expiresAt: string;
    }): Promise<Session>;
    activateSession(sessionId: string, onchainRegistryReference: string): Promise<Session>;
    revokeSession(sessionId: string): Promise<Session>;
    getSession(sessionId: string): Promise<Session | null>;
}
export interface PermissionEngine {
    grant(input: Omit<Permission, 'id' | 'createdAt'>): Promise<Permission>;
    revoke(permissionId: string): Promise<void>;
    list(agentId: string): Promise<Permission[]>;
}
export interface ToolGateway {
    listTools(agent: Agent): Promise<Tool[]>;
    call<TResult = unknown>(toolName: string, input: Record<string, unknown>, context: {
        agentId: string;
        correlationId: string;
    }): Promise<TResult>;
}
export interface StrategyEngine {
    observe(agent: Agent, correlationId: string): Promise<Observation[]>;
    decide(observation: Observation, agent: Agent, hooks?: {
        onDecision?: (decision: StrategyDecision) => void;
    }): Promise<ActionProposal | null>;
    /** Validate strategy config before first cycle. Throws with a clear message when config is invalid. */
    preflight?(agent: Agent): Promise<{
        ok: true;
    } | {
        ok: false;
        reason: string;
    }>;
}
export interface PolicyEngine {
    validateAction(proposal: ActionProposal, context: {
        agentId: string;
        userId: string;
        sessionId?: string;
    }): Promise<PolicyDecision>;
}
export interface JobScheduler {
    enqueue(input: {
        jobType: string;
        agentId: string;
        userId: string;
        correlationId: string;
        idempotencyKey: string;
        payload: Record<string, unknown>;
        runAt?: string;
    }): Promise<{
        jobId: string;
    }>;
}
export interface ExecutionEngine {
    execute(proposal: ActionProposal, context: {
        agentId: string;
        userId: string;
        correlationId: string;
        session: Session;
    }): Promise<Execution>;
    reconcile(executionId: string): Promise<Execution>;
}
export interface PositionRepository {
    getPositions(agentId: string): Promise<Position[]>;
    upsertPosition(position: Position): Promise<void>;
}
export interface PerformanceEngine {
    recordExecution(execution: Execution): Promise<void>;
    getPerformance(agentId: string): Promise<Performance | null>;
}
export interface AuditBus {
    emit(event: Omit<AuditEvent, 'eventId' | 'createdAt'>): Promise<AuditEvent>;
}
export interface StrategyDefinition {
    type: string;
    capabilities: string[];
    tools: string[];
    observationSchedule: string;
    decisionHandler: (observation: Observation, agent: Agent) => Promise<ActionProposal | null>;
    riskPolicy: {
        maxRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
        requiredCapabilities: string[];
    };
}
export interface StrategyRegistration {
    registerStrategy(definition: StrategyDefinition): Promise<void>;
    getStrategy(type: string): Promise<StrategyDefinition | null>;
    listStrategies(): Promise<StrategyDefinition[]>;
}
export declare function canTransition(current: string, next: string, machine: 'agent' | 'session' | 'execution'): boolean;
//# sourceMappingURL=index.d.ts.map