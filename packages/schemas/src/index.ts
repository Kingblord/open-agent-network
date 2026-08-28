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

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** EVM-compatible address (loose — not all BAN surfaces are strictly EIP-55). */
export const AddressSchema = z.string();
export type Address = z.infer<typeof AddressSchema>;

/** ISO-8601 timestamp string. */
export const ISO8601Schema = z.string();
export type ISO8601 = z.infer<typeof ISO8601Schema>;

/** Selected action types a policy/executor can act on. */
export const ActionTypeSchema = z.enum([
  'SWAP',
  'TRANSFER',
  'DEPOSIT',
  'WITHDRAW',
  'STAKE',
  'UNSTAKE',
  'MINT',
  'BURN',
  'APPROVE',
  'REBALANCE',
  'CUSTOM',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

// ---------------------------------------------------------------------------
// Agents (M3 — BAN Agent Registry)
// ---------------------------------------------------------------------------

export const AgentStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'REVOKED',
  'EXPIRED',
  'ERROR',
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const CapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // Action types this capability permits. Empty/absent means the capability
  // grants its `id` as an opaque action allow-entry (matched on capabilityId).
  actions: z.array(ActionTypeSchema).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * Authoritative agent record. Owned by the BAN Agent Registry (`agents`
 * collection). `type` / `strategyId` are opaque references — the registry
 * never knows strategy-specific internals. `riskLevel` is the agent's risk
 * profile (LOW/MEDIUM/HIGH) used by the policy engine.
 */
export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  ownerId: z.string(),
  type: z.string(),
  strategyId: z.string().optional(),
  walletAddress: z.string().optional(),
  status: AgentStatusSchema,
  capabilities: z.array(CapabilitySchema),
  protocols: z.array(z.string()),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  createdAt: ISO8601Schema,
  updatedAt: ISO8601Schema,
});
export type Agent = z.infer<typeof AgentSchema>;

// ---------------------------------------------------------------------------
// Jobs (M2 — durable executor)
// ---------------------------------------------------------------------------

export const JobTypeSchema = z.enum([
  'agent-observation',
  'agent-decision',
  'agent-execution',
  'market-data',
  'position-sync',
  'performance',
  'notifications',
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTER',
  'CANCELLED',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  jobId: z.string(),
  jobType: JobTypeSchema,
  agentId: z.string(),
  userId: z.string(),
  correlationId: z.string(),
  idempotencyKey: z.string(),
  attempt: z.number().int().min(1),
  createdAt: ISO8601Schema,
  scheduledAt: ISO8601Schema,
  payload: z.record(z.string(), z.unknown()),
  // `status` is a live snapshot maintained by the job repo (not part of the
  // initial claim), so it is optional here.
  status: JobStatusSchema.optional(),
  lastError: z
    .object({ code: z.string().optional(), message: z.string().optional() })
    .optional(),
});
export type Job = z.infer<typeof JobSchema>;

// ---------------------------------------------------------------------------
// Sessions (M4 — Altana scoped sessions)
// ---------------------------------------------------------------------------

export const SessionStatusSchema = z.enum([
  'PENDING',
  'ACTIVE',
  'EXPIRING',
  'EXPIRED',
  'REVOKED',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  walletAddress: AddressSchema,
  sessionKeyReference: z.string(),
  allowedContracts: z.array(AddressSchema),
  allowedFunctions: z.array(z.string()),
  allowedTokens: z.array(z.string()),
  spendCap: z.string(), // wei/bigint as decimal string (cumulative ceiling)
  perTransactionCap: z.string(),
  expiresAt: ISO8601Schema,
  status: SessionStatusSchema.default('PENDING'),
  onchainRegistryReference: z.string().nullable().default(null),
  createdAt: ISO8601Schema,
  updatedAt: ISO8601Schema,
});
export type Session = z.infer<typeof SessionSchema>;

// ---------------------------------------------------------------------------
// Permissions (M5 — scoped action authority)
// ---------------------------------------------------------------------------

export const PermissionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  protocol: z.string().optional(),
  contract: AddressSchema.optional(),
  action: ActionTypeSchema.optional(),
  functions: z.array(z.string()).optional(),
  creditedToken: z.string().optional(),
  amount: z.string().optional(),
  createdAt: ISO8601Schema,
});
export type Permission = z.infer<typeof PermissionSchema>;

/**
 * A proposed onchain action from a strategy/decision layer. This is the input
 * unit to the PolicyEngine. `estimatedValue` is the pessimistic worst-case
 * spend in wei (source wei, not slippage-adjusted).
 */
export const ActionProposalSchema = z.object({
  proposalId: z.string(),
  agentId: z.string(),
  userId: z.string(),
  strategyId: z.string().optional(),
  sessionId: z.string(),
  protocol: z.string(),
  contract: AddressSchema,
  function: z.string(),
  action: ActionTypeSchema,
  capabilityId: z.string().optional(),
  token: z.string(),
  amount: z.string(), // wei decimal string (asset units)
  estimatedValue: z.string(), // wei decimal string used for spend accounting
  asset: z.string(), // symbol e.g. "BNB", "USDT"
  params: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string(),
  nonce: z.string().optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  createdAt: ISO8601Schema,
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const PolicyDecisionValueSchema = z.enum(['ALLOW', 'DENY']);
export type PolicyDecisionValue = z.infer<typeof PolicyDecisionValueSchema>;

export const PolicyRuleResultSchema = z.object({
  check: z.string(),
  passed: z.boolean(),
  reason: z.string().optional(),
});
export type PolicyRuleResult = z.infer<typeof PolicyRuleResultSchema>;

/** Complete, auditable output of a policy evaluation. */
export const PolicyDecisionSchema = z.object({
  decision: PolicyDecisionValueSchema,
  proposalId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  policyVersion: z.string(),
  checks: z.array(PolicyRuleResultSchema),
  deniedCheck: z.string().optional(),
  reason: z.string().optional(),
  reservationId: z.string().optional(),
  reservedAt: z.string().optional(),
  createdAt: ISO8601Schema,
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// ---------------------------------------------------------------------------
// Spend ledger (M5 — atomic reserve-before-execute accounting)
// ---------------------------------------------------------------------------

export const SpendReservationStatusSchema = z.enum([
  'RESERVED',
  'COMMITTED',
  'RELEASED',
]);
export type SpendReservationStatus = z.infer<typeof SpendReservationStatusSchema>;

export const SpendLedgerEntrySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  proposalId: z.string(),
  executionId: z.string().nullable(),
  amount: z.string(), // wei decimal string
  asset: z.string(),
  status: SpendReservationStatusSchema,
  idempotencyKey: z.string(),
  createdAt: ISO8601Schema,
  updatedAt: ISO8601Schema,
});
export type SpendLedgerEntry = z.infer<typeof SpendLedgerEntrySchema>;

// ---------------------------------------------------------------------------
// Executions (M8 — execution engine)
// ---------------------------------------------------------------------------

export const ExecutionStatusSchema = z.enum([
  'PROPOSED',
  'VALIDATING',
  'REJECTED',
  'QUEUED',
  'EXECUTING',
  'CONFIRMING',
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionSchema = z.object({
  executionId: z.string(),
  proposalId: z.string(),
  agentId: z.string(),
  userId: z.string(),
  protocol: z.string(),
  contract: AddressSchema,
  function: z.string(),
  parametersHash: z.string(),
  transactionHash: z.string().nullable(),
  chainId: z.number(),
  gasUsed: z.string().nullable(),
  status: ExecutionStatusSchema,
  errorCode: z.string().nullable(),
  createdAt: ISO8601Schema,
  confirmedAt: ISO8601Schema.nullable(),
});
export type Execution = z.infer<typeof ExecutionSchema>;

// ---------------------------------------------------------------------------
// Positions / Performance (M9+ — position repository)
// ---------------------------------------------------------------------------

export const PositionSchema = z.object({
  positionId: z.string(),
  agentId: z.string(),
  protocol: z.string(),
  contract: AddressSchema,
  asset: z.string(),
  amount: z.string(), // raw units
  entryValueUsd: z.string(),
  currentValueUsd: z.string(),
  openedAt: ISO8601Schema,
  updatedAt: ISO8601Schema,
});
export type Position = z.infer<typeof PositionSchema>;

export const PerformanceSchema = z.object({
  performanceId: z.string(),
  agentId: z.string(),
  startAt: ISO8601Schema,
  realizedPnlUsd: z.string(),
  unrealizedPnlUsd: z.string(),
  totalTrades: z.number().int().min(0),
  winRate: z.string(),
  maxDrawdownUsd: z.string(),
  updatedAt: ISO8601Schema,
});
export type Performance = z.infer<typeof PerformanceSchema>;

// ---------------------------------------------------------------------------
// Audit (all milestones — structured, queryable governance records)
// ---------------------------------------------------------------------------

export const AuditEventSchema = z.object({
  eventId: z.string(),
  type: z.string(),
  severity: z.enum(['INFO', 'WARN', 'ERROR', 'CRITICAL']).default('INFO'),
  correlationId: z.string().optional(),
  agentId: z.string().optional(),
  userId: z.string().optional(),
  proposalId: z.string().optional(),
  sessionId: z.string().optional(),
  executionId: z.string().optional(),
  policyVersion: z.string().optional(),
  checks: z.array(PolicyRuleResultSchema).optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  createdAt: ISO8601Schema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ---------------------------------------------------------------------------
// Tools (M6 — deterministic blockchain data + preflight layer)
//
// ToolCapability is the CANONICAL capability-ID vocabulary used by ToolRegistry
// to gate which tools an agent may invoke. It is deliberately separate from the
// broader `CapabilitySchema` (an agent's full capability declaration); tool
// capabilities are the narrower, canonical READ_*/PROPOSE_* vocabulary the
// registry matches tool names against.
// ---------------------------------------------------------------------------

export const ToolCapabilitySchema = z.enum([
  'READ_BALANCE',
  'READ_PRICE',
  'READ_YIELD',
  'READ_LENDING_POSITION',
  'READ_LP_POSITION',
  'PROPOSE_SWAP',
  'PROPOSE_LP_REBALANCE',
  'PROPOSE_LENDING_ACTION',
  'PROPOSE_GRID_ORDER',
]);
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

/** A registered tool the AI may invoke. `capabilityId` is the ONLY window into
 *  the tool — the AI cannot invent a tool name; it must be registered here with
 *  an explicit, canonical capability it requires. */
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  capabilityId: ToolCapabilitySchema,
  // JSONSchema-ish (loose) input descriptor used for surfacing/driving input
  // validation. ToolRegistry also enforces a provided zod inputSchema.
  input: z.record(z.string(), z.unknown()).default({}),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** Structured, capability-validated tool result. Never a raw RPC blob, never a
 *  private key, never an arbitrary contract call. */
export const ToolResultSchema = z.object({
  ok: z.boolean(),
  tool: z.string(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
  timestamp: ISO8601Schema,
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  correlationId: z.string().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// ---------------------------------------------------------------------------
// Misc shared bits referenced by the package graph
// ---------------------------------------------------------------------------

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
export type Tool = z.infer<typeof ToolSchema>;

export const ObservationSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  observedAt: ISO8601Schema,
});
export type Observation = z.infer<typeof ObservationSchema>;

// ---------------------------------------------------------------------------
// AI Brain (M: reasoning layer output)
//
// The AI is a reasoning layer ONLY. It consumes structured `Observation`s and —
// when it decides to act — emits a strict `StrategyDecision` whose `proposal`
// conforms to `ActionProposalSchema`. Every decision is re-validated by the
// brain adapter (fail-closed) before being passed to the policy engine. The
// AI can never sign, execute, or invent tools; it only produces proposals.
// ---------------------------------------------------------------------------

export const StrategyDecisionStatusSchema = z.enum(['PASS', 'ACT']);
export type StrategyDecisionStatus = z.infer<typeof StrategyDecisionStatusSchema>;

/**
 * Strict, re-validated output envelope of the AI brain.
 * - `status: 'PASS'` → the AI chose to take no action (reason required when
 *   the agent was expected to act but declined).
 * - `status: 'ACT'` → a fully-formed, validated `proposal` ready for the
 *   policy engine. The proposal must already satisfy `ActionProposalSchema`
 *   AND be backed by one of the agent's granted capabilities.
 */
export const StrategyDecisionSchema = z.object({
  decisionId: z.string(),
  agentId: z.string(),
  strategyId: z.string().optional(),
  status: StrategyDecisionStatusSchema,
  proposal: ActionProposalSchema.optional(),
  observations: z.array(ObservationSchema).default([]),
  deniedReason: z.string().optional(),
  reasoning: z.string().optional(),
  createdAt: ISO8601Schema,
});
export type StrategyDecision = z.infer<typeof StrategyDecisionSchema>;