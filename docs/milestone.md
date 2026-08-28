# BAN Smart Money — Development Milestones

## 0. Purpose

This document is the implementation contract for the coding agent.

Build **BAN (BNB Agent Network)** as the project/network layer that powers **BAN Smart Money**: a BNB Chain marketplace where users discover, hire, authorize, monitor and revoke autonomous financial agents.

**Naming boundary:** BAN is the project's product/network name. It is **not** BNB Chain's official network infrastructure.

BAN has two responsibilities:

1. **BAN Core** — reusable agent infrastructure: identity, agent registry, wallets/sessions, permissions, tool access, strategy runtime, policy enforcement, execution, jobs, events, audit and reputation.
2. **BAN Smart Money** — the first BAN application: four first-class BNB financial agents for yield optimisation, health-factor monitoring, LP rebalancing and grid trading.

The product must satisfy the marketplace journey:

```text
DISCOVER -> UNDERSTAND -> HIRE -> AUTHORIZE -> OBSERVE -> DECIDE -> EXECUTE -> VERIFY -> MONITOR -> REVOKE
```

The four financial systems are first-class and must have equal implementation depth:

1. Yield Optimisation
2. Health Factor Monitoring
3. LP Rebalancing
4. Grid Trading

The AI is **only the brain/reasoning layer**. It receives structured observations through approved tools, reasons over those observations, and emits a strict `ActionProposal`. It never owns transaction authority, private keys, unrestricted RPC access, permissions, spend limits, or the ability to bypass BAN policy.

Every executable action must pass deterministic validation, authorization, policy/risk checks, idempotency protection, simulation/preflight where supported, execution, receipt verification and state reconciliation.

Firebase is the application control plane/state layer. **Firestore** is durable application state. The control-plane API is **Next.js route handlers on Vercel**. Durable asynchronous jobs run on **Inngest (primary) with QStash as an approved fallback** — not Cloud Functions and not Google Cloud Tasks. GitHub Actions is used for CI/CD only and is explicitly NOT an agent runtime.

## Automation stack decision (approved)

| Role | Chosen technology | Explicitly NOT used for this |
|---|---|---|
| Control-plane API | Next.js route handlers on Vercel | Cloud Functions for Firebase |
| Durable jobs/queues | Inngest (primary); QStash (fallback) | Google Cloud Tasks, Firestore-as-queue |
| Retries/backoff/dedupe/dead-letter | Inngest retries + dead-letter queues | — |
| Scheduled observations | Inngest schedules | GitHub Actions cron |
| CI/CD | GitHub Actions (lint, test, build, deploy) | GitHub Actions as a runtime |
| Durable state | Firestore | — |
| Blockchain | BNB Chain (testnet first) | — |

Rationale:

- GitHub Actions runners are **ephemeral** (killed after each job), cannot host persistent authenticated endpoints, and cannot resume in-flight agent state.
- GHA cron granularity is **~5 minutes minimum and not guaranteed on-time** — insufficient for a health-factor agent that must react in 1–2 minute windows.
- Agent schedules are **created at runtime** per user/agent; GHA schedules are static YAML baked at commit time.
- Private-repo minutes are **quota-limited**; four agents polling every minute would exhaust a month of quota in hours.
- Financial execution control flow must not depend on a GitHub token + secret set inside a YAML file. The rule remains: policy engine → executor, never "YAML → runner → wallet".

This decision **does not change any security invariant**. The following remain mandatory: idempotency keys on every job, reconcile-before-retry (never blindly resubmit a financial action), dead-letter + audit trail (`correlationId/proposalId/jobId/executionId/txHash`), AI = reasoning only, and adapter interfaces for every integration.

---

# 1. Target Architecture

BAN is a layered network/application architecture, not a monolithic agent.

```text
                           BAN SMART MONEY
                                |
                    +-----------+-----------+
                    |                       |
              MARKETPLACE                BAN CORE
                    |                       |
          Discover / Compare / Hire         |
                    |                       |
                    +-----------+-----------+
                                |
                         AGENT CONTROL PLANE
                                |
              +-----------------+-----------------+
              |                 |                 |
          Identity          Sessions          Registry
              |                 |                 |
              +-----------------+-----------------+
                                |
                         AGENT RUNTIME PLANE
                                |
       +----------------+-------+--------+----------------+
       |                |                |                |
    Strategies      AI Brain        Tool Gateway      Risk Engine
       |                |                |                |
       +----------------+-------+--------+----------------+
                                |
                         ACTION PROPOSAL
                                |
                         BAN POLICY ENGINE
                                |
                      +---------+----------+
                      |                    |
                   DENY                 APPROVE
                      |                    |
                    Audit              Inngest
                                           |
                                   EXECUTION ENGINE
                                           |
                                   Altana Session
                                           |
                                    Agent Wallet
                                           |
                                      BNB Chain
                                           |
             +-----------------------------+--------------------------+
             |                |                |                     |
         PancakeSwap        Venus             Aave                 Lista
             |                |                |                     |
             +-----------------------------+--------------------------+
                                           |
                                  STATE RECONCILIATION
                                           |
                     +---------------------+--------------------+
                     |                     |                    |
                 Positions            Performance            Audit
                     |                     |                    |
                     +---------------------+--------------------+
                                           |
                                      MARKETPLACE
```

## BAN architectural boundaries

### Control plane

Owns:

- user identity
- agent identity
- agent registry
- agent lifecycle
- session metadata
- permission policies
- strategy configuration
- job orchestration
- audit events
- marketplace metadata

### Runtime plane

Owns:

- observations
- tool calls
- AI reasoning
- strategy calculations
- candidate actions
- policy evaluation
- execution
- verification
- position reconciliation

### Data plane

Owns:

- BNB Chain state
- protocol adapters
- price/yield/lending/LP data
- transaction receipts
- agent positions
- performance measurements

### Trust boundary

The only component allowed to cross from BAN's logical runtime into blockchain transaction authority is the **Execution Engine**, and it may do so only through a valid scoped agent session.

```text
AI != signer
AI != wallet
AI != policy
AI != executor

AI = reasoning engine
```

## Core technology decisions

- Frontend: Next.js/React/TypeScript.
- Backend/control plane: Next.js route handlers on Vercel + Firebase (Firestore, Authentication, App Check).
- Database: Firestore.
- Authentication: Firebase Authentication (+ JWT session cookies for the control-plane API).
- Backend protection: Firebase App Check where applicable; per-route auth middleware.
- Durable jobs: Inngest (primary) or QStash (fallback) on Vercel — NOT Cloud Tasks, NOT Firestore-as-queue.
- Scheduled observations: Inngest schedules — NOT GitHub Actions cron.
- CI/CD: GitHub Actions (lint, test, build, deploy) — never a runtime.
- AI: tool-calling LLM; AI is not the transaction authority.
- Blockchain: BNB Chain.
- Agent wallet/session: Altana for the hackathon integration.
- Strategy modules: deterministic TypeScript services plus AI reasoning where useful.
- Blockchain interaction: viem or the project's selected EVM SDK.
- Protocol integrations: adapter interfaces; never scatter protocol SDK calls across strategies.
- Secrets: Vercel/Google Secret Manager environment configuration; never Firestore.
- Observability: structured logs + Firestore execution/audit records.
- Idempotency: mandatory for every asynchronous execution.
- State reconciliation: transaction receipts and onchain reads are authoritative for financial state.
- Testnet first; mainnet only after all safety gates pass.
- Optional discovery/reputation: 8004scan integration.
- Optional agent commerce: Altana ERC-8183/x402/B402 integrations after the core loop is stable.

## BAN core interfaces

All strategy implementations must depend on stable BAN interfaces rather than Firebase, Altana or individual protocol SDK details.

```text
AgentRegistry
SessionManager
PermissionEngine
ToolGateway
StrategyEngine
PolicyEngine
JobScheduler
ExecutionEngine
PositionRepository
PerformanceEngine
AuditBus
```

Protocol-specific adapters implement:

```text
YieldAdapter
LendingAdapter
LiquidityAdapter
SwapAdapter
PriceDataAdapter
```

This keeps BAN reusable beyond the four hackathon strategies.

---

# 2. Non-Negotiable Security Model

The following rule applies everywhere:

```text
AI decision
    -> Action Proposal
    -> Authentication
    -> Session validation
    -> Permission validation
    -> Spend-limit validation
    -> Protocol/contract/function allowlist
    -> Token/asset validation
    -> Risk validation
    -> Idempotency check
    -> Simulation/preflight where supported
    -> Execution
    -> Receipt verification
    -> State update
```

The AI cannot bypass any stage.

Never implement:

```text
LLM -> private key -> transaction
```

Implement:

```text
LLM -> structured proposal -> deterministic policy engine -> executor
```

---

# 3. BAN Domain Model

## Core entities

```text
User
  owns
Agent
  has
AgentWallet
  has
Session
  grants
Permissions
  constrain
ActionProposal
  becomes
Execution
  updates
Position
  feeds
Performance
```

## Agent lifecycle

Every BAN agent follows the same conceptual lifecycle:

```text
REGISTER
 -> CONFIGURE
 -> AUTHORIZE
 -> OBSERVE
 -> REASON
 -> PROPOSE
 -> VALIDATE
 -> EXECUTE
 -> VERIFY
 -> RECONCILE
 -> REPORT
```

Every strategy plugs into this lifecycle instead of creating its own execution path.

## Agent capability model

Agents declare capabilities such as:

```text
READ_BALANCE
READ_PRICE
READ_YIELD
READ_LENDING_POSITION
READ_LP_POSITION
PROPOSE_SWAP
PROPOSE_LP_REBALANCE
PROPOSE_LENDING_ACTION
PROPOSE_GRID_ORDER
```

Capabilities are descriptive. They do not grant execution authority. Execution authority comes from the active session plus BAN policy.

## Financial-state authority

Firestore is a control-plane cache and audit store. Blockchain state is authoritative for balances, token ownership, LP positions, lending positions, transaction status and session/onchain authorization state. Every completed financial execution must trigger reconciliation against chain state.

---

# 3. System State Model

Use explicit state machines rather than implicit boolean flags.

### Agent

```text
DRAFT
ACTIVE
PAUSED
REVOKED
EXPIRED
ERROR
```

### Session

```text
PENDING
ACTIVE
EXPIRING
EXPIRED
REVOKED
```

### Action

```text
PROPOSED
VALIDATING
REJECTED
QUEUED
EXECUTING
CONFIRMING
CONFIRMED
FAILED
CANCELLED
```

### Job

```text
QUEUED
RUNNING
SUCCEEDED
RETRYING
FAILED
DEAD_LETTER
```

Invalid state transitions must be rejected.

---

# MILESTONE 1 — Foundation + Control-Plane Runtime

## Objective

Create a deployable application skeleton with Next.js (frontend + serverless API routes), Firebase, authentication, Firestore, Inngest durable queues and structured logging.

## Build

- Monorepo/project structure.
- TypeScript strict mode.
- Firebase project configuration.
- Firebase Authentication.
- Firestore.
- Next.js API route handlers as the control-plane API (Vercel serverless).
- Inngest durable queues + schedules.
- GitHub Actions CI workflow (lint, test, build, deploy).
- Environment configuration.
- Secret management.
- Local emulators (Firestore) + Inngest dev server.
- Structured logging.
- Basic error taxonomy.
- Request correlation IDs.

## Required collections

```text
users
agents
agent_sessions
agent_permissions
strategies
action_proposals
executions
jobs
positions
market_data
performance
audit_events
agent_events
protocol_configs
```

Firestore is durable application state, not the asynchronous execution queue. Inngest owns asynchronous dispatch, retry and scheduling.

## Closed loop

```text
User signs in
    -> Firebase Auth
    -> route handler verifies identity
    -> user document exists
    -> authenticated API request succeeds
    -> Firestore record created
    -> log emitted
```

## Done when

A fresh developer can clone the project, set up Firebase + Inngest, authenticate, create a user, invoke a backend route handler and see structured logs.

---

# MILESTONE 2 — Durable Job System

## Objective

Build the asynchronous execution backbone before building agents.

Use **Inngest** rather than treating Firestore as a queue.

## Queues

At minimum:

```text
agent-observation
agent-decision
agent-execution
market-data
position-sync
performance
```

Optional:

```text
notifications
dead-letter
```

## Job contract

Every job must contain:

```text
jobId
jobType
agentId
userId
correlationId
idempotencyKey
attempt
createdAt
scheduledAt
payload
```

## Requirements

- Retry policy.
- Exponential backoff.
- Dispatch deadline.
- Idempotency.
- Duplicate execution protection.
- Dead-letter handling.
- Job status persistence.
- Structured logs.
- Queue-specific concurrency limits.
- Retry classification: safe-to-retry vs do-not-retry.
- Financial execution jobs must carry a deterministic idempotency key.
- A retry must reconcile state rather than blindly submit a second transaction.

## Closed loop

```text
API/Event
  -> create job
  -> Inngest
  -> worker function
  -> process
  -> persist result
  -> mark job complete
```

Failure:

```text
worker error
  -> retry
  -> retry limit
  -> DEAD_LETTER
  -> audit event
```

## Done when

A test job can be queued, processed, intentionally failed, retried, deduplicated and eventually dead-lettered.

---

# MILESTONE 3 — Agent Identity + Registry

## Objective

Create the generic BAN agent model.

## Build

Agent CRUD:

```text
createAgent
getAgent
updateAgent
pauseAgent
activateAgent
revokeAgent
listAgents
```

Agent fields:

```text
id
name
description
type
ownerId
walletAddress
status
capabilities[]
protocols[]
riskLevel
strategyId
createdAt
updatedAt
```

## Closed loop

```text
Create agent
  -> registry
  -> agent document
  -> capability validation
  -> marketplace can discover agent
```

## Done when

A registered agent can be displayed, activated, paused and revoked without any strategy-specific code.

---

# MILESTONE 4 — Agent Wallet + Altana Session

## Objective

Integrate Altana as the agent authority layer.

The hackathon requires agents to have their own wallets, scoped sessions, real limits, Keystore registration, real onchain transactions, and user-facing revocation. Verify all current Altana SDK/API details against the current official documentation before implementation.

## Session fields

```text
sessionId
agentId
walletAddress
sessionKeyReference
allowedContracts[]
allowedFunctions[]
allowedTokens[]
spendCap
perTransactionCap
expiresAt
status
onchainRegistryReference
```

## Closed loop

```text
User hires agent
  -> agent wallet exists
  -> session requested
  -> limits selected
  -> session registered
  -> Firestore reflects pending/active state
  -> onchain registration verified
  -> session ACTIVE
```

## Revocation loop

```text
User clicks REVOKE
  -> backend verifies ownership
  -> Altana revoke
  -> onchain confirmation
  -> local session REVOKED
  -> agent execution denied
```

## Done when

A testnet agent can obtain a scoped session and the product can prove that an unauthorized action is rejected.

---

# MILESTONE 5 — Deterministic Permission / Policy Engine

## Objective

Build the safety gate between the AI and execution.

## API

```text
validateAction(proposal)
```

## Checks

```text
agent active?
session active?
session unexpired?
contract allowed?
function allowed?
token allowed?
amount <= transaction cap?
cumulative spend <= total cap?
strategy allows action?
risk policy passes?
nonce/idempotency valid?
```

Return a structured decision:

```text
ALLOW
or
DENY + machine-readable reason
```

## Closed loop

```text
Action proposal
  -> policy engine
  -> all checks pass
  -> APPROVED
```

or:

```text
Action proposal
  -> policy engine
  -> violation
  -> DENIED
  -> audit event
  -> no transaction
```

## Done when

A complete automated test suite proves that every configured permission boundary is enforced.

---

# MILESTONE 6 — Blockchain Data + Tool Layer

## Objective

Create deterministic tools that the AI can call.

The AI should not directly access RPC, private keys or arbitrary contracts.

## Tool interface

Examples:

```text
getTokenBalance
getTokenPrice
getPoolState
getPoolPosition
getYieldOpportunities
getLendingPosition
getHealthFactor
getGasEstimate
simulateTransaction
getTransactionStatus
```

Tools return structured JSON only.

Example:

```json
{
  "asset": "USDT",
  "protocol": "Venus",
  "apy": 8.21,
  "timestamp": "..."
}
```

## Rule

Tools are capability-limited.

The AI cannot invent a tool name or arbitrary contract call.

## Closed loop

```text
Agent observation job
  -> tool call
  -> blockchain/data provider
  -> structured result
  -> agent context
```

## Done when

The four future strategies can obtain all required data without direct blockchain access from the LLM.

---

# MILESTONE 7 — AI Brain / Tool-Calling Runtime

## Objective

Implement the AI as the reasoning layer only.

## AI responsibilities

- Interpret structured observations.
- Decide whether action is warranted.
- Compare valid candidate actions.
- Explain decisions.
- Produce a strict ActionProposal.
- Request additional information only through registered tools.

## AI must NOT

- hold keys.
- sign transactions.
- choose arbitrary contracts outside registered tools.
- invent tool results.
- bypass policy.
- alter spend limits.
- change session permissions.
- revoke itself.
- execute raw RPC.
- write directly to financial-state records.
- enqueue an execution job without a validated proposal.

## ActionProposal schema

```text
proposalId
agentId
strategyId
actionType
protocol
contract
function
parameters
estimatedValue
reason
confidence
expiresAt
```

## Closed loop

```text
Observation
  -> AI tool calls
  -> structured context
  -> AI reasoning
  -> ActionProposal
  -> schema validation
  -> policy engine
```

No approved proposal means no execution.

## Done when

The AI can observe a controlled test environment and generate valid proposals, while malformed or unauthorized proposals are rejected before execution.

---

# MILESTONE 8 — Generic Execution Engine

## Objective

Create one executor shared by every strategy.

## Pipeline

```text
ActionProposal
 -> validate
 -> policy
 -> idempotency
 -> preflight/simulation
 -> queue
 -> executor
 -> Altana/session authorization
 -> sign/send
 -> receipt
 -> verify
 -> persist
```

## Execution record

```text
executionId
proposalId
agentId
userId
protocol
contract
function
parametersHash
transactionHash
chainId
gasUsed
status
errorCode
createdAt
confirmedAt
```

## Closed loop

```text
Proposal
 -> approved
 -> queued
 -> transaction submitted
 -> receipt confirmed
 -> execution CONFIRMED
 -> position/performance update
 -> audit event
```

## Failure loop

```text
Execution failure
 -> classify error
 -> reconcile chain state
 -> retry only if safe/retryable
 -> otherwise FAILED
 -> audit
 -> surface actionable error

Never decide retryability from an LLM response.

Examples:

RPC timeout after submission
  -> reconcile transaction first
  -> NEVER blindly resubmit

Preflight failure
  -> do not execute

Permission failure
  -> permanent rejection

Temporary provider failure
  -> safe retry
```

## Done when

One controlled testnet transaction can travel through the complete pipeline and be visible in the UI.

---

# MILESTONE 9 — Yield Optimisation Agent

## Objective

First complete autonomous financial strategy.

## Components

```text
YieldDataProvider
YieldNormalizer
YieldRiskModel
YieldCandidateSelector
YieldStrategy
```

## Decision model

```text
gross yield
- protocol fees
- swap cost
- gas
- slippage
- risk adjustment
= effective opportunity
```

The AI receives candidate opportunities rather than raw unbounded market data.

## Closed loop

```text
Observe yields
 -> normalize
 -> identify opportunity
 -> AI evaluates
 -> proposal
 -> policy
 -> execution
 -> verify
 -> position update
 -> performance update
```

## Done when

A testnet user can activate the agent, set a cap, and observe a complete automated yield action.

---

# MILESTONE 10 — Health Factor Monitoring Agent

## Objective

Protect lending positions.

## Inputs

```text
collateral
borrowed
LTV
liquidation threshold
health factor
asset prices
```

## States

```text
HEALTHY
WARNING
CRITICAL
EMERGENCY
```

## Closed loop

```text
Observe lending position
 -> calculate health factor
 -> determine risk state
 -> AI decides whether action is useful
 -> proposal
 -> policy
 -> execution if authorized
 -> verify
 -> recalculate health factor
```

## Done when

A controlled test position can move between risk states and produce a deterministic warning/action workflow.

---

# MILESTONE 11 — LP Rebalancing Agent

## Objective

Automatically manage a concentrated liquidity position.

## Inputs

```text
pool
current price
tick range
liquidity
fees
volume
position value
```

## Strategy

```text
Observe position
 -> detect range inefficiency
 -> calculate candidate range
 -> AI evaluates
 -> propose remove/reposition/add
 -> policy
 -> execution
 -> verify
 -> update position
```

## Safety

Never rebalance solely because an LLM says so.

A deterministic strategy layer must calculate the candidate range and minimum acceptable conditions.

## Done when

A testnet LP position can be analyzed and safely repositioned through the common execution engine.

---

# MILESTONE 12 — Grid Trading Agent

## Objective

Implement a bounded automated grid strategy.

## Configuration

```text
lowerPrice
upperPrice
gridCount
capital
perGridAllocation
maxPosition
stopConditions
```

## Closed loop

```text
Observe price
 -> determine grid crossing
 -> deterministic grid signal
 -> AI validates/chooses action
 -> proposal
 -> policy
 -> execute swap
 -> verify
 -> update grid state
 -> performance update
```

## Safety

The grid must have:

- maximum capital.
- maximum order size.
- maximum active exposure.
- stop conditions.
- session expiry.
- duplicate-order protection.

## Done when

A testnet grid can execute multiple controlled cycles without exceeding configured limits.

---

# MILESTONE 13 — Agent Marketplace

## Objective

Build **BAN Smart Money**, the public marketplace surface of BAN.

BAN Smart Money is the first consumer application of BAN Core. It must feel like a real agent marketplace, not four strategy dashboards placed beside each other.

The hackathon requires all four categories to have equal depth.

## Pages

```text
/
  marketplace

/agents/:id
  overview
  strategy
  performance
  permissions
  activity

/my-agents
  active agents
  positions
  sessions

/my-agents/:id
  live state
  actions
  performance
  permissions
  revoke
```

## Agent card

Must expose useful decision information:

```text
name
category
risk
capital
performance
success rate
supported protocols
current state
permissions
```

## Closed loop

```text
Discover
 -> inspect
 -> compare
 -> hire
 -> configure limits
 -> activate
 -> monitor
 -> revoke
```

## Done when

A new user can discover and activate every category without reading technical documentation.

---

# MILESTONE 14 — Live Agent Activity + Audit Trail

## Objective

Make autonomous behavior observable.

## Event types

```text
AGENT_ACTIVATED
AGENT_PAUSED
AGENT_REVOKED
OBSERVATION_CREATED
AI_DECISION_CREATED
ACTION_PROPOSED
ACTION_DENIED
ACTION_APPROVED
EXECUTION_QUEUED
TRANSACTION_SUBMITTED
TRANSACTION_CONFIRMED
TRANSACTION_FAILED
POSITION_UPDATED
```

## Closed loop

Every important action:

```text
event
 -> Firestore audit record
 -> structured log
 -> UI activity feed
```

## Done when

A judge can watch an agent work and understand exactly why a transaction occurred.

---

# MILESTONE 15 — Performance + Agent Reputation

## Objective

Turn raw execution data into useful marketplace information.

## Metrics

```text
PnL
yield
fees
gas
success rate
execution count
average execution time
drawdown where applicable
capital managed
```

Never manufacture historical performance.

Clearly distinguish:

```text
LIVE
TESTNET
SIMULATED
```

## Closed loop

```text
Execution confirmed
 -> performance calculation
 -> aggregate metrics
 -> agent profile
 -> marketplace ranking/display
```

## Done when

Every agent has transparent, reproducible performance metrics.

---

# MILESTONE 16 — Agent Advantage Report

## Objective

Satisfy the TermiX challenge with real evidence.

Run at least three tasks:

```text
Agent
vs
Manual/non-agent
```

Record:

```text
time
cost
output quality
actual output
```

At least one task must involve trading, stocks or security.

## Closed loop

```text
Task selected
 -> manual run recorded
 -> agent run recorded
 -> normalize measurements
 -> compare
 -> generate evidence
 -> attach outputs
```

## Done when

The repository contains reproducible experiment data and the final submission includes the required Agent Advantage Report.

---

# MILESTONE 17 — PancakeSwap Integration / Benefit

## Objective

Ensure the project delivers an obvious benefit to PancakeSwap traders or LPs.

At least one strategy should produce a strong PancakeSwap-specific demo.

Preferred:

```text
LP Rebalancer
+
PancakeSwap Liquidity
```

or:

```text
Yield Optimizer
+
PancakeSwap opportunities
```

## Closed loop

```text
PancakeSwap state
 -> strategy analysis
 -> agent decision
 -> scoped execution
 -> PancakeSwap transaction
 -> verified result
 -> performance
```

---

# MILESTONE 18 — End-to-End Hackathon Demo

## Objective

One uninterrupted demo should prove the entire architecture.

## Demo

```text
1. Open marketplace
2. Browse four categories
3. Open Yield Agent
4. Review performance/risk
5. Hire agent
6. Set $25 transaction cap
7. Set 24h expiry
8. Select allowed protocols
9. Create Altana session
10. Verify session
11. Agent observes market
12. AI calls tools
13. AI produces proposal
14. Policy engine approves
15. Inngest job executes
16. Agent wallet signs
17. BNB transaction confirms
18. UI updates
19. Performance updates
20. User revokes agent
21. Attempted subsequent action is denied
```

## Done when

A judge can see the entire autonomous loop without manual backend intervention.

---

# MILESTONE 19 — Security / Failure Testing

## Objective

Prove that the system fails safely.

Test:

```text
expired session
revoked session
oversized transaction
unauthorized contract
unauthorized function
unauthorized token
duplicate job
duplicate proposal
RPC failure
transaction revert
insufficient balance
slippage violation
stale price
AI malformed output
AI hallucinated protocol
Inngest retry
worker crash
```

## Required invariant

```text
No permission = no transaction.
```

And:

```text
AI failure = no transaction.
```

Also:

```text
Queue retry != duplicate financial action.
```

## Done when

All safety tests pass.

---

# MILESTONE 20 — BAN Network Integration Layer

## Objective

Prove that BAN is a reusable network/control layer rather than a one-off Smart Money application.

## Build

Expose stable BAN Core interfaces so future applications can reuse:

```text
AgentRegistry
SessionManager
ToolGateway
PolicyEngine
JobScheduler
ExecutionEngine
AuditBus
PerformanceEngine
```

Create a strategy registration mechanism:

```text
registerStrategy({
  type,
  capabilities,
  tools,
  observationSchedule,
  decisionHandler,
  riskPolicy
})
```

BAN Smart Money registers the four strategies through this mechanism rather than hardcoding them into the core runtime.

## Closed loop

```text
Register strategy
  -> BAN validates capability/tool declarations
  -> strategy becomes discoverable
  -> agent instance created
  -> session configured
  -> strategy runs through common runtime
  -> execution uses common policy/execution layer
  -> performance/audit use common infrastructure
```

## Done when

A fifth non-DeFi test strategy can be registered without modifying the BAN execution engine, permission engine or job system.

---

# MILESTONE 21 — Production/Judging Readiness

## Checklist

```text
[ ] Publicly accessible frontend
[ ] Four agent categories complete
[ ] BNB Chain integration
[ ] Altana agent wallets
[ ] Altana sessions
[ ] Call allowlists
[ ] Spend caps
[ ] Expiry
[ ] Onchain session registration
[ ] Real testnet transactions
[ ] User-facing revoke
[ ] Marketplace discovery
[ ] Agent profiles
[ ] Performance data
[ ] Activity/audit trail
[ ] Agent Advantage Report
[ ] PancakeSwap benefit
[ ] Error handling
[ ] Security tests
[ ] Demo script
[ ] README
[ ] Architecture diagram
[ ] Environment documentation
[ ] No exposed secrets
[ ] CI/CD pipeline (GitHub Actions)
```

---

# 4. Recommended Repository Structure

```text
ban-smart-money/
│
├── apps/
│   └── web/                      # Next.js: frontend + control-plane API routes + Inngest functions
│
├── packages/
│   ├── schemas/
│   ├── agent-core/
│   ├── policy-engine/
│   ├── execution-engine/
│   ├── blockchain/
│   └── shared/
│
├── firestore/
│   ├── firestore.rules
│   └── firestore.indexes.json
│
├── docs/
│   ├── architecture.md
│   ├── security.md
│   └── agent-advantage-report.md
│
├── scripts/
│
├── .github/
│   └── workflows/                # CI/CD only: lint, test, build, deploy
│
└── milestone.md
```

Inngest functions co-locate inside `apps/web` (route handlers / Inngest worker), so no separate `functions/` package is required.

---

# 5. Coding-Agent Rules

The coding agent must follow these rules throughout implementation.

## Rule 1 — Closed loops only

Do not mark a milestone complete because files were created.

A milestone is complete only when its entire loop works.

Example:

```text
observe
→ decide
→ validate
→ execute
→ verify
→ persist
→ display
```

## Rule 2 — Build from the core outward

Never build four separate agent architectures.

All agents must use:

```text
Agent Runtime
Policy Engine
Execution Engine
Job System
Audit System
```

## Rule 3 — AI never executes

AI outputs structured proposals only.

## Rule 4 — Blockchain authority is deterministic

Only the execution layer can submit transactions.

## Rule 5 — Every financial job is idempotent

A retry must never blindly repeat a financial action.

## Rule 6 — Testnet first

No mainnet transaction until the corresponding test suite and safety checks pass.

## Rule 7 — No fake data in production paths

Mocks may exist only behind explicit development/test providers.

## Rule 8 — Every integration gets an adapter

Do not scatter PancakeSwap/Venus/Aave/Altana SDK calls throughout the codebase.

Use:

```text
adapters/
```

and expose stable internal interfaces.

## Rule 9 — Strong schemas

Use shared TypeScript schemas for:

```text
Agent
Session
Permission
Tool
Observation
ActionProposal
Execution
Job
Position
Performance
```

Validate external/AI input at runtime.

## Rule 10 — Observability is part of implementation

Every autonomous action must be traceable by:

```text
correlationId
agentId
proposalId
jobId
executionId
transactionHash
```

---

# 6. Final Architecture In One Loop

The finished system should reduce to this:

```text
                    USER
                      |
                      v
                 MARKETPLACE
                      |
                   HIRE
                      |
                      v
             ALTANA SESSION
                      |
                      v
               AGENT RUNTIME
                      |
             +--------+--------+
             |                 |
             v                 v
          TOOLS               AI
             |                 |
             +--------+--------+
                      |
                 PROPOSAL
                      |
                      v
               POLICY ENGINE
                      |
              +-------+-------+
              |               |
            DENY             ALLOW
              |               |
              v               v
            AUDIT          INNGEST
                              |
                              v
                       EXECUTION ENGINE
                              |
                              v
                         ALTANA WALLET
                              |
                              v
                          BNB CHAIN
                              |
                              v
                         TRANSACTION
                              |
                              v
                           VERIFY
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
          POSITION        PERFORMANCE       AUDIT
              |               |               |
              +---------------+---------------+
                              |
                              v
                         MARKETPLACE
                              |
                              v
                         USER SEES IT
```

This is the architecture the coding agent should implement incrementally.

The hackathon's current requirements explicitly make the four categories, live BSC agents, and—if pursuing Altana—the scoped wallet/session/onchain transaction flow central to the submission.

---

# 7. BAN Hackathon Qualification Matrix

| Requirement | BAN implementation |
|---|---|
| Marketplace | BAN Smart Money marketplace |
| Rebalancing | BAN LP Rebalancer |
| Grid Trading | BAN Grid Agent |
| Yield Optimisation | BAN Yield Agent |
| Health Factor Monitoring | BAN Health Agent |
| Agent wallets | Altana agent wallets |
| Scoped sessions | BAN Session Manager + Altana |
| Call allowlist | BAN Policy Engine |
| Spend cap | BAN Policy Engine + session |
| Expiry | BAN Session Manager + session |
| Keystore/onchain registration | Altana integration |
| Real transactions | BAN Execution Engine |
| User revocation | BAN Marketplace + Session Manager |
| Agent discovery/reputation | BAN Registry + optional 8004scan |
| PancakeSwap benefit | LP Rebalancer and/or PancakeSwap Trading adapter |
| Agent Advantage Report | BAN experiment harness |

The current hackathon requires all four agent categories with equal depth for the main marketplace. The Altana track requires live onchain transactions, agent-owned wallets, scoped sessions with call allowlists/spend caps/expiry, onchain registration and user-facing revocation.

---

# 8. BAN Product Principle

BAN is not:

```text
AI + wallet
```

BAN is:

```text
IDENTITY
+
CAPABILITY
+
SCOPED AUTHORITY
+
AI REASONING
+
DETERMINISTIC POLICY
+
DURABLE EXECUTION
+
ONCHAIN VERIFICATION
+
OBSERVABILITY
```

The user does not hire an LLM.

The user hires an **agent with a bounded authority envelope**.

That distinction must be visible in the product and reflected in the code.

---

# 9. BAN Closed-Loop Definition of Done

A BAN feature is not complete until this pattern works:

```text
USER
  |
  v
DISCOVER
  |
  v
CONFIGURE
  |
  v
AUTHORIZE
  |
  v
OBSERVE
  |
  v
AI REASONS THROUGH TOOLS
  |
  v
ACTION PROPOSAL
  |
  v
SCHEMA VALIDATION
  |
  v
POLICY / RISK / LIMIT CHECK
  +---- DENY ----> AUDIT ----> USER
  |
  v
IDEMPOTENCY CHECK
  |
  v
INNGEST
  |
  v
EXECUTION ENGINE
  |
  v
ALTANA SESSION
  |
  v
BNB CHAIN
  |
  v
RECEIPT
  |
  v
RECONCILIATION
  +---- FAILURE --> SAFE RECOVERY
  |
  v
POSITION UPDATE
  |
  v
PERFORMANCE UPDATE
  |
  v
AUDIT EVENT
  |
  v
MARKETPLACE / USER
```

If a new feature cannot fit this loop, stop and redesign it before implementation.

---

# 10. BAN Development Priority

Implement in this order:

```text
1. Foundation + control-plane runtime (Firebase + Next.js routes)
2. Durable job system (Inngest)
3. BAN Agent Registry
4. BAN Session/Permission model
5. Tool Gateway
6. AI Brain
7. Policy Engine
8. Generic Execution Engine
9. One complete Yield loop
10. Health Factor loop
11. LP Rebalancing loop
12. Grid Trading loop
13. Marketplace
14. Activity/Audit
15. Performance/Reputation
16. Altana qualification proof
17. PancakeSwap proof
18. Agent Advantage experiments
19. BAN fifth-strategy extensibility proof
20. Security/failure tests
21. Final demo
```

Do not build marketplace polish before at least one agent completes the full:

```text
observe -> reason -> propose -> authorize -> execute -> verify -> reconcile
```

loop.

---

# 11. Control-Plane / Durable-Job Implementation Constraint

Use Firebase as the BAN control plane, but do not turn Firestore into a distributed scheduler.

```text
Firestore
  = durable application state

Inngest / QStash
  = asynchronous delivery/retry/scheduling

Next.js route handlers (Vercel)
  = trusted control-plane API workers

GitHub Actions
  = CI/CD only (lint, test, build, deploy) — never an agent runtime

Blockchain
  = authoritative financial state
```

Inngest provides retries, exponential backoff, concurrency control, deduplication, dead-letter queues and runtime-created schedules, making it the intended durable queue boundary for BAN's asynchronous workers. QStash is the approved fallback with the same boundary semantics.

---

# 12. Final BAN Architecture

```text
                         BAN
              BNB AGENT NETWORK
                           |
          +----------------+----------------+
          |                                 |
   BAN SMART MONEY                    BAN CORE
   marketplace/app                 reusable network
          |                                 |
          |        +------------------------+----------------------+
          |        |          |             |          |            |
          |     Registry    Sessions      Tools      Policy       Jobs
          |        |          |             |          |            |
          +--------+----------+-------------+----------+------------+
                           |
                      Agent Runtime
                           |
                +----------+----------+
                |                     |
             Strategy              AI Brain
                |                     |
                +----------+----------+
                           |
                    Action Proposal
                           |
                    BAN Policy Engine
                           |
                        Inngest
                           |
                    Execution Engine
                           |
                     Altana Session
                           |
                      Agent Wallet
                           |
                       BNB Chain
                           |
          +----------------+----------------+
          |                |                |
      PancakeSwap        Venus             Aave
          |                |                |
          +----------------+----------------+
                           |
                    Reconciliation
                           |
                 +---------+---------+
                 |         |         |
             Position  Performance  Audit
                 |         |         |
                 +---------+---------+
                           |
                     BAN Marketplace
```

The objective is not merely to win a hackathon with four bots. The objective is to demonstrate BAN as a reusable autonomous-agent execution network, with Smart Money as its first vertical.