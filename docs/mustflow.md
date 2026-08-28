# BAN — MUSTFLOW.md

## Canonical Runtime, Mainnet & Contract-Interaction Specification

> **Core principle:** AI is the brain, not the authority.
>
> The AI may **observe, reason, choose, and propose**. It may never directly sign,
> send, bypass policy, change limits, invent contract addresses, invent tools, or
> execute arbitrary calldata.

---

# 1. Canonical User Story

A user wants BAN to autonomously optimize a limited amount of funds on BNB Smart Chain.

The user gives BAN **bounded authority**. The AI receives intelligence and decision-making responsibility, but **not unrestricted financial authority**.

---

# 2. User Enters BAN

```text
User
 ↓
BAN Web App
 ↓
Connect Wallet / Authenticate
 ↓
User Account
 ↓
Dashboard
```

Technical components:

- `apps/web`
- Firebase Auth
- Firestore
- BAN API

User record:

```text
users/{userId}
```

Minimum data:

```json
{
  "id": "user_123",
  "walletAddress": "0x...",
  "chainId": 56,
  "createdAt": "..."
}
```

BAN must verify that the authenticated wallet belongs to the user.

---

# 3. Agent Discovery

Route:

```text
/agents
```

The marketplace consumes the real Agent Registry:

```text
GET /api/agents
 ↓
Agent Registry
 ↓
Firestore
```

Never use hardcoded marketplace agents.

Only display data that actually exists in BAN.

---

# 4. Agent Detail

Route:

```text
/agents/:id
```

Retrieve:

```text
GET /api/agents/:id
GET /api/agents/:id/performance
GET /api/agents/:id/activity
GET /api/agents/:id/sessions
```

Never fabricate:

- AI confidence
- APY
- portfolio value
- holdings
- P&L
- allocation
- uptime
- performance

If data is unavailable:

```text
No data yet
—
Not available
Awaiting first execution
```

---

# 5. Activate Agent

```text
Frontend
 ↓
POST /api/agents/:id/lifecycle
 ↓
Agent Registry
 ↓
Authorization
 ↓
ACTIVE
```

Audit:

```text
AGENT_ACTIVATED
```

---

# 6. Create Bounded Session

The user defines authority:

```text
Network: BNB Smart Chain
Maximum transaction: $20
Daily limit: $100
Allowed tokens: USDT, USDC, WBNB
Allowed protocols: PancakeSwap, Venus
Risk: MEDIUM
Session duration: 24h
```

Technical:

```text
POST /api/sessions
```

A session should include:

```text
sessionId
userId
agentId
walletAddress
chainId
status
expiresAt
permissions
spend limits
protocol allowlist
token allowlist
contract/function restrictions
```

**The AI must never receive the private key.**

---

# 7. Agent Runtime

```text
Scheduler
 ↓
Reliable Job Queue
 ↓
Agent Runtime
```

Jobs contain identifiers such as:

```json
{
  "agentId": "agent_123",
  "sessionId": "session_123"
}
```

Never place private keys in jobs.

---

# 8. AI Uses Tools

The AI never calls RPC directly.

```text
AI
 ↓
Tool Registry
 ↓
Capability Check
 ↓
Tool
 ↓
Blockchain/Data Adapter
```

Core tools:

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

The Tool Registry enforces:

```text
tool exists
+
capability exists
+
input schema valid
```

Unknown tools are rejected.

**AI cannot invent a tool name.**

---

# 9. Real BNB Chain Data

Production configuration:

```text
BAN_RPC_URL
BAN_CHAIN_ID=56
```

BAN must verify:

```text
eth_chainId()
 ↓
56?
 ├── YES → START
 └── NO  → REFUSE TO START
```

BSC:

```text
Mainnet = 56
Testnet = 97
```

Never allow a mainnet configuration to operate against testnet.

---

# 10. Contract & Asset Registry

BAN needs a controlled registry between strategy/AI and executable contracts.

Recommended package:

```text
packages/registry
```

Structure:

```text
src/
├── token-registry.ts
├── protocol-registry.ts
├── contract-registry.ts
├── deployment-registry.ts
├── address-verifier.ts
├── abi-registry.ts
└── index.ts
```

The registry becomes the internal source of truth for executable assets/contracts.

---

# 11. Contract Discovery

External sources may be used for discovery:

```text
CoinGecko / GeckoTerminal
DefiLlama
BNB Chain documentation
Official protocol deployment documentation
Official protocol SDKs / ABIs
```

But discovery data is **not automatically execution authority**.

Correct flow:

```text
External Sources
 ↓
Contract Discovery
 ↓
Verification
 ↓
BAN Registry
 ↓
Execution
```

---

# 12. Token Registry

Example:

```json
{
  "chainId": 56,
  "address": "0x...",
  "symbol": "USDT",
  "name": "Tether USD",
  "decimals": 18,
  "verified": true,
  "enabled": true
}
```

Important:

```text
verified ≠ executable
```

A token can be recognized without being allowed for autonomous execution.

---

# 13. Protocol Registry

Example:

```json
{
  "id": "pancakeswap",
  "chainId": 56,
  "name": "PancakeSwap",
  "status": "ACTIVE",
  "official": true
}
```

Deployment:

```json
{
  "protocolId": "pancakeswap",
  "chainId": 56,
  "contracts": {
    "router": "0x...",
    "factory": "0x...",
    "quoter": "0x..."
  }
}
```

Addresses must be verified against authoritative sources and/or on-chain verification before being enabled.

---

# 14. Contract Capability Model

The registry must understand what each contract is allowed to do.

Example:

```text
PancakeSwap
├── Router
│   ├── approved swap operations
│   └── approved liquidity operations
├── Quoter
│   └── READ ONLY
└── Factory
    └── READ ONLY
```

Therefore:

```text
getPoolState
 ↓
Factory / Pool
 ↓
READ
```

while:

```text
executeSwap
 ↓
Router
 ↓
EXECUTE
```

The AI never chooses an arbitrary contract address.

---

# 15. EVM SDK

Use a mature EVM library such as:

```text
viem
```

Architecture:

```text
BAN Tool
 ↓
Protocol Adapter
 ↓
Contract Registry
 ↓
Verified Address + ABI
 ↓
viem
 ↓
BNB RPC
```

Do not build unnecessary custom low-level RPC/ABI infrastructure.

---

# 16. Protocol Adapter Boundary

Example:

```text
PancakeSwapAdapter
├── getPoolState()
├── quoteSwap()
├── simulateSwap()
└── buildSwap()
```

The adapter owns:

```text
contract address
ABI
function
parameter validation
protocol-specific logic
```

The AI requests abstract operations.

Never:

```text
AI → arbitrary contract → calldata
```

Correct:

```text
AI
 ↓
PROPOSE_SWAP
 ↓
PancakeSwapAdapter
 ↓
known router
 ↓
known function
 ↓
validated parameters
```

---

# 17. Deterministic Strategy Layer

Raw market data must not directly become an autonomous action.

Yield:

```text
YieldDataProvider
 ↓
YieldNormalizer
 ↓
YieldRiskModel
 ↓
YieldCandidateSelector
 ↓
Bounded YieldCandidates
```

Effective opportunity:

```text
gross yield
- protocol fees
- swap cost
- gas
- slippage
- risk adjustment
=
effective opportunity
```

LP:

```text
LiquidityAdapter
 ↓
LpCalculator
 ↓
Risk Model
 ↓
LpCandidateSelector
 ↓
Bounded LP Candidates
```

LP candidate generation must be deterministic.

AI must not invent:

```text
lowerTick
upperTick
tickSpacing
liquidity
arbitrary calldata
```

---

# 18. AI Receives Candidates

Example:

```json
{
  "candidates": [
    {
      "id": "candidate_A",
      "protocol": "PancakeSwap",
      "effectiveYield": "10.4",
      "risk": "MEDIUM"
    },
    {
      "id": "candidate_B",
      "protocol": "Venus",
      "effectiveYield": "8.7",
      "risk": "LOW"
    }
  ]
}
```

The AI reasons over the bounded candidate set.

The AI then produces:

```text
StrategyDecision
```

---

# 19. ActionProposal Boundary

AI produces:

```text
ActionProposal
```

Example:

```json
{
  "agentId": "yield-agent-01",
  "sessionId": "session_123",
  "actionType": "PROPOSE_SWAP",
  "candidateId": "candidate_A",
  "protocol": "PancakeSwap",
  "riskLevel": "MEDIUM",
  "estimatedValue": "18 USDT"
}
```

Then:

```text
AI PROCESS ENDS
```

The proposal enters the authority zone.

---

# 20. Policy Engine

```text
ActionProposal
 ↓
PolicyEngine
```

Checks:

```text
capability
session status
expiration
agent/user relationship
risk
protocol
token
contract
function
spending
```

Unknown risk fails closed.

---

# 21. Spend Reservation

Before execution:

```text
spend_ledger
```

Statuses:

```text
RESERVED
COMMITTED
RELEASED
```

Flow:

```text
Policy Approval
 ↓
Atomic Reservation
 ↓
RESERVED
```

Example:

```text
Committed = $40
Reserved  = $10
Requested = $18

Total = $68
Limit = $100

ALLOW
```

Reservation must happen before execution.

---

# 22. Execution Engine

Only approved proposals enter execution.

```text
ActionProposal
 ↓
ExecutionEngine
```

Pipeline:

```text
idempotency
 ↓
preflight
 ↓
simulation
 ↓
queue
 ↓
session authorization
 ↓
transaction construction
 ↓
sign
 ↓
send
 ↓
receipt
 ↓
reconcile
 ↓
verify
 ↓
persist
```

---

# 23. Idempotency

```text
executionId = deterministic(proposalId)
```

Before execution:

```text
getExecution(executionId)
```

If already `CONFIRMED`, never execute again.

If an RPC times out after submission, reconcile the original transaction before retrying.

---

# 24. Simulation

```text
ActionProposal
 ↓
Transaction Builder
 ↓
simulateTransaction()
 ↓
Gas Estimate
 ↓
Expected State Change
```

Failure:

```text
EXECUTION FAILED
RESERVED → RELEASED
```

No transaction is submitted.

---

# 25. Queue & Worker

```text
ExecutionEngine
 ↓
Reliable Job Queue
 ↓
Worker
 ↓
Sign / Send
```

Retries belong to execution infrastructure.

A network timeout after submission is not automatically a failed transaction.

---

# 26. Session Authorization Before Signing

Before signing:

```text
session ACTIVE?
not expired?
correct agent?
correct user?
correct chain?
correct permissions?
```

Failure:

```text
SESSION_REVOKED
```

No transaction.

---

# 27. Transaction Construction

Use only known protocol adapters:

```text
PancakeSwapAdapter
 ↓
known router
 ↓
known function
 ↓
validated parameters
```

Never:

```text
AI → arbitrary contract calldata
```

---

# 28. Signer Boundary

```text
AI
 ✗ private key

Strategy
 ✗ private key

Policy
 ✗ private key

ExecutionEngine
 ↓
SessionSigner
 ↓
sign(transaction)
```

The AI never receives private keys, seed phrases, or an unrestricted signer.

---

# 29. Mainnet Transaction Safety

Every real transaction must enforce:

```text
simulation
slippage protection
deadline
gas limits
nonce management
contract allowlist
function allowlist
token allowlist
amount limits
```

Never allow uncontrolled swap slippage.

---

# 30. Submit to BNB Chain

```text
signed transaction
 ↓
BNB RPC
 ↓
BNB Smart Chain
```

Record:

```text
txHash
```

Execution status:

```text
EXECUTING
```

then:

```text
CONFIRMING
```

---

# 31. Confirmation & Reconciliation

Query:

```text
getTransactionStatus(txHash)
```

Possible states:

```text
PENDING
CONFIRMED
FAILED
```

Recovery scenario:

```text
transaction submitted ✓
RPC response lost ✗
worker crashes ✗
```

On resume:

```text
executionId
 ↓
known txHash?
 ↓
getTransactionStatus()
```

If confirmed:

```text
CONFIRMED
```

Do not submit another transaction.

---

# 32. Spend Commit / Release

Success:

```text
RESERVED
 ↓
COMMITTED
```

Definitive failure:

```text
RESERVED
 ↓
RELEASED
```

All transitions must be idempotent.

---

# 33. Position & Performance Update

After confirmation:

```text
BNB Chain
 ↓
Blockchain Adapters
 ↓
Balances / Positions
 ↓
Performance Engine
 ↓
Firestore
```

Possible real metrics:

```text
token balance
LP position
lending position
fees
gas
PnL
execution result
```

Only calculate P&L/APY when sufficient real observations exist.

---

# 34. Audit Trail

Record the complete decision chain:

```text
AGENT_ACTIVATED
SESSION_CREATED
OBSERVATION_CREATED
CANDIDATES_GENERATED
AI_DECISION_CREATED
PROPOSAL_CREATED
POLICY_APPROVED
SPEND_RESERVED
EXECUTION_STARTED
TRANSACTION_SUBMITTED
TRANSACTION_CONFIRMED
SPEND_COMMITTED
POSITION_UPDATED
```

This creates an explainable autonomous-action trail.

---

# 35. Dashboard

The UI consumes real APIs:

```text
GET /api/agents
GET /api/agents/:id/performance
GET /api/agents/:id/activity
GET /api/agents/:id/sessions
GET /api/jobs
GET /api/credits/transactions
```

Never fabricate financial data.

Examples:

```text
Portfolio
No positions yet.
```

```text
APY
Not available.
```

```text
Execution History
No executions yet.
```

Never generate fake historical chart points.

---

# 36. Complete BAN Closed Loop

```text
USER
 ↓
BAN WEB APP
 ↓
AUTH / AGENT REGISTRY
 ↓
USER SESSION
 ↓
SCHEDULER
 ↓
AGENT RUNTIME
 ↓
TOOLS
 ↓
BLOCKCHAIN / PROTOCOLS
 ↓
DETERMINISTIC STRATEGY
 ↓
BOUNDED CANDIDATES
 ↓
AI
 ↓
ACTION PROPOSAL
 ↓
════════════════════════════
       AUTHORITY ZONE
════════════════════════════
 ↓
POLICY ENGINE
 ↓
SPEND RESERVATION
 ↓
EXECUTION ENGINE
 ↓
IDEMPOTENCY
 ↓
SIMULATION
 ↓
QUEUE
 ↓
SESSION
 ↓
SIGNER
 ↓
BNB MAINNET
 ↓
CONFIRMATION
 ↓
RECONCILIATION
 ↓
PERFORMANCE + AUDIT
 ↓
FIRESTORE
 ↓
DASHBOARD
 ↓
NEXT OBSERVATION CYCLE
```

---

# 37. Mainnet MVP

Do not attempt to support every protocol.

Target:

```text
BSC MAINNET
 ├── PancakeSwap
 └── ONE additional real DeFi protocol
```

Minimum credible live loop:

```text
1 real RPC
1 real protocol adapter
1 real session/wallet implementation
1 real strategy
strict allowlists
strict spend limits
simulation
reconciliation
emergency pause
```

A narrow, genuinely live loop is better than many simulated strategies.

---

# 38. Mainnet Gates

## Gate A — Network

```text
BAN_RPC_URL
BAN_CHAIN_ID=56
eth_chainId() == 56
```

Fail closed otherwise.

## Gate B — Real Data

Replace DevDataProvider with production implementations behind existing interfaces.

## Gate C — Real Protocols

Implement specific protocol adapters.

## Gate D — Real Session / Signer

Implement production signing boundary.

## Gate E — Simulation

Every autonomous transaction must pass preflight.

## Gate F — Policy

Every proposal must pass capability/risk/spend/session/protocol/contract/function checks.

## Gate G — Accounting

Every execution must create a reservation and resolve it to committed/released.

## Gate H — Reconciliation

Every submitted transaction must be safely recoverable.

## Gate I — Security

Implement:

```text
contract allowlist
function allowlist
token allowlist
amount limits
global pause
agent pause
session revoke
```

## Gate J — Observability

Track:

```text
executions
failures
policy denials
RPC failures
gas
spend
queue depth
stuck transactions
session expiry
unusual activity
```

---

# 39. Suggested Post-M15 Path

```text
M15
Foundation
 ↓
M16
Contract & Asset Registry
 ↓
M17
Real BSC Mainnet Data Providers
 ↓
M18
Real Protocol Adapters
 ↓
M19
Production Session / Signer
 ↓
M20
Live Policy → Execution Integration
 ↓
M21
Mainnet Simulation + Reconciliation
 ↓
M22
Security / Limits / Emergency Controls
 ↓
M23
One Real Autonomous Mainnet Loop
 ↓
M24
Production Observability
```

Milestone numbers may be adjusted to the existing project plan, but these dependencies should remain.

---

# 40. BAN Absolute Invariants

### 1. AI is not authority

```text
AI ≠ authority
```

### 2. No AI private-key access

```text
AI → private key = FORBIDDEN
```

### 3. No direct AI execution

```text
AI → blockchain transaction = FORBIDDEN
```

### 4. No invented tools

```text
Unknown tool = REJECT
```

### 5. No invented executable addresses

```text
Unregistered contract = REJECT
```

### 6. No AI-generated LP ranges

```text
LLM-generated lowerTick/upperTick = REJECT
```

### 7. Unknown risk fails closed

```text
UNKNOWN RISK = DENY
```

### 8. Spend must be reserved first

```text
RESERVE → EXECUTE
```

never:

```text
EXECUTE → RESERVE
```

### 9. Every execution must be idempotent

```text
same proposal ≠ second transaction
```

### 10. Mainnet is chain 56

```text
MAINNET = 56
```

### 11. External discovery is not execution authority

```text
External source → discovery
BAN Registry → authority
```

### 12. BAN never fabricates financial data

If BAN has not measured it:

```text
DO NOT DISPLAY IT AS FACT
```

### 13. No arbitrary calldata

```text
unregistered contract/function = REJECT
```

### 14. Every real execution follows

```text
Policy
 ↓
Reservation
 ↓
Simulation
 ↓
Execution
 ↓
Reconciliation
```

---

# 41. One-Sentence BAN Architecture

> **BAN is a constrained autonomous financial-agent system where deterministic blockchain infrastructure produces verified opportunities, AI reasons over bounded candidates and creates proposals, policy controls authority, the execution engine safely executes approved actions, and reconciliation turns real BNB Chain outcomes back into the agent's next observation.**

---

# 42. Final Implementation Rule

**Do not implement features in isolation.**

Every new:

```text
package
milestone
API
tool
strategy
protocol adapter
UI feature
execution capability
```

must fit into the canonical BAN loop defined in this document.

If a feature bypasses:

```text
Tool Capability
→ Deterministic Strategy
→ ActionProposal
→ Policy
→ Spend Reservation
→ Simulation
→ Execution
→ Reconciliation
```

it is architecturally invalid unless this document is explicitly revised.
