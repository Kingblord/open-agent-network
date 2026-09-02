# BAN — UPDATE.md
## Authoritative Implementation Update: Agent Services + User-Fund Authorization

**Date:** 2026-09-01  
**Current milestone:** M15

## 1. CODING AGENT — READ FIRST

Do not rebuild BAN. Preserve the existing M1–M15 architecture, strategy packages, Policy Engine, Spend Ledger, Execution Engine, Inngest runtime, Firestore control plane, protocol registry, and current Altana integration.

### Critical clarification

**Altana is the agent's operational wallet.**

Use it for agent-owned operational needs such as:

- x402/service payments
- external API/service costs
- agent operational transactions
- gas where applicable

**Do not assume user investment capital belongs in the Altana wallet.**

When a job genuinely requires the agent to operate on **user-owned funds**, the future authorization path is EIP-7702.

```text
USER FUNDS
User Wallet
    ↓
EIP-7702 bounded authorization
    ↓
BAN Agent
    ↓
Policy Engine
    ↓
Execution Engine
    ↓
BNB DeFi
```

The four BAN-native agents remain:

```text
Yield Optimisation
Health Factor Monitoring
LP Rebalancing
Grid Trading
```

---

# 2. THE TWO MONEY FLOWS

## A. Agent operational money

```text
Agent
 ↓
Altana Agent Wallet
 ↓
operational expenses
```

Examples:

```text
x402 services
external APIs
agent operational transactions
gas where applicable
```

Altana is the agent's operational/execution wallet.

It is **not automatically the user's investment account**.

## B. User-owned DeFi funds

```text
USER
 ↓
USER WALLET
 ↓
USDT / assets / DeFi positions
```

If an agent needs to manage these:

```text
User
 ↓
EIP-7702 authorization
 ↓
bounded agent authority
 ↓
BAN Policy Engine
 ↓
Execution Engine
 ↓
BNB protocol
```

Do not move user investment capital into Altana merely because the user hired an agent.

---

# 3. SIMPLE PRODUCT MENTAL MODEL

```text
                         USER
                          │
                          ▼
                     BAN MARKETPLACE
                          │
                          ▼
                         JOB
                          │
              ┌───────────┴───────────┐
              │                       │
       Service required?       User funds required?
              │                       │
             YES                     YES
              │                       │
              ▼                       ▼
       ALTANA WALLET             EIP-7702
       Agent's wallet            User-wallet authority
              │                       │
              ▼                       ▼
       Service / x402             User's assets
              │                       │
              └───────────┬───────────┘
                          ▼
                     BAN AGENT
                          │
                    OBSERVE / DECIDE
                          │
                    ACTION PROPOSAL
                          │
                     POLICY ENGINE
                          │
                     SPEND LEDGER
                          │
                    EXECUTION ENGINE
                          │
                       BNB CHAIN
```

Simple rule:

> **Altana = where the agent's operational money lives.**
>
> **EIP-7702 = a future mechanism for giving the agent bounded authority to act on user-owned funds.**

---

# 4. ERC-8004 — DISCOVERY / TRUST

Use ERC-8004 for:

```text
agent identity
agent discovery
capabilities
reputation
validation/trust
```

Flow:

```text
ERC-8004
 ↓
identity/capabilities/reputation
 ↓
BAN normalization
 ↓
/agents
 ↓
/agents/[id]
```

Never fabricate reputation or performance.

BAN-native agents must remain visible if external ERC-8004 infrastructure fails.

---

# 5. ERC-8183 — JOB / FULFILLMENT / SETTLEMENT

Use ERC-8183 for the job lifecycle where appropriate:

```text
hire
→ create job
→ fund where applicable
→ perform
→ submit
→ evaluate
→ settle
```

ERC-8183 does **not** automatically provide wallet authority and does **not** automatically revoke EIP-7702 authority.

BAN owns the relationship between job state and permission state.

---

# 6. x402 — AGENT SERVICE PAYMENTS

Use x402 when the agent needs to pay an external machine-accessible service.

Example:

```text
Agent
 ↓
External API/service
 ↓
HTTP 402
 ↓
x402 payment
 ↓
Altana operational wallet
 ↓
Service response
 ↓
Agent continues
```

Do not use EIP-7702 simply because the agent needs to pay for its own services.

Create an abstraction such as:

```text
ServicePaymentProvider
```

with deterministic/dev and live implementations.

---

# 7. USER-FUNDS JOB FLOW

When a user hires an agent, determine whether the job requires access to user-owned funds.

## No user funds

```text
User
 ↓
Hire agent
 ↓
ERC-8183 job
 ↓
Agent performs task
 ↓
x402 if a paid external service is needed
 ↓
Agent submits result
 ↓
ERC-8183 settlement
```

No EIP-7702 authorization should be requested.

## User funds required

```text
User
 ↓
Hire agent
 ↓
ERC-8183 job
 ↓
BAN determines exact required permissions
 ↓
User reviews permissions
 ↓
ONE EIP-7702 authorization
 ↓
Agent operates within bounded scope
 ↓
Agent creates ActionProposal
 ↓
Policy Engine validates
 ↓
Spend Ledger reserves
 ↓
Preflight
 ↓
Execution Engine
 ↓
EIP-7702 authorization path
 ↓
User's account
 ↓
BNB protocol
 ↓
Receipt / verification
 ↓
Spend committed
 ↓
Job continues
 ↓
Job fulfilled
 ↓
ERC-8183 reaches terminal state
 ↓
BAN invalidates/revokes job-scoped authority
```

---

# 8. EIP-7702 IS NOT THE SKILL SYSTEM

Keep these concepts separate:

```text
BAN Skills / Capabilities
= WHAT the agent can do

EIP-7702
= HOW the agent may receive wallet authority

Policy Engine
= WHETHER this action is allowed

Spend Ledger
= HOW MUCH has been used

Execution Engine
= HOW the approved action executes
```

Example:

```text
Health Agent
 ↓
Skill: REPAY
 ↓
EIP-7702 bounded authority
 ↓
Policy:
  user ✓
  agent ✓
  job ✓
  Venus ✓
  USDT ✓
  repay selector ✓
  risk ✓
  spend ✓
 ↓
Execution
```

---

# 9. JOB-SCOPED AUTHORIZATION

Never present this as:

> "Give the agent control of your wallet."

The intended UX is:

> "Allow this agent to perform these approved actions for this job within these limits."

Example:

```text
Agent:
Health Agent

Job:
Protect Venus Position

Token:
USDT

Total allowance:
1,000 USDT

Maximum single transaction:
250 USDT

Allowed protocol:
Venus

Allowed functions:
repay(...)
approved collateral operations

Expiry:
job expiry / explicit time limit
```

Do not grant unlimited wallet authority.

---

# 10. WHAT HAPPENS WHEN THE JOB ENDS

If user funds stayed in the user's account:

```text
User assets
 ↓
remain in user's wallet/account
```

When the job authorization expires/revokes:

```text
User assets → remain with user
Agent authority → becomes inactive
```

There is no "return funds" transaction because the user funds were never transferred to Altana.

Altana operational funds are a separate model. If BAN ever needs to return Altana-owned funds, that requires an explicit transaction and accounting flow.

---

# 11. ERC-8183 + EIP-7702 TERMINATION

Do not assume:

```text
ERC-8183 closes
→ EIP-7702 automatically revokes
```

Instead:

```text
ERC-8183 terminal state
 ↓
BAN marks associated authorization inactive
 ↓
future proposal for that job
 ↓
REJECT
```

Terminal states include:

```text
COMPLETED
FAILED
REJECTED
EXPIRED
CANCELLED
```

Use appropriate mechanisms such as:

```text
job-status validation
expiry
nonce invalidation
explicit revocation
permission-state transition
```

Keep EIP-7702 mechanics inside its isolated package.

---

# 12. ALTANA → EIP-7702 ARCHITECTURE

Current working path:

```text
Agent
 ↓
Altana operational wallet
 ↓
Session
 ↓
Policy Engine
 ↓
Execution Engine
 ↓
BNB Chain
```

Future user-funds path:

```text
Agent
 ↓
ActionProposal
 ↓
Policy Engine
 ↓
Spend Ledger
 ↓
Execution Engine
 ↓
AuthorizationProvider
 ↓
EIP-7702
 ↓
User's account
 ↓
BNB Chain
```

Use an abstraction:

```text
AuthorizationProvider
```

with implementations conceptually equivalent to:

```text
AltanaAuthorizationProvider
Eip7702AuthorizationProvider
```

But keep their responsibilities clear:

```text
AltanaAuthorizationProvider
→ current agent-wallet/session authority

Eip7702AuthorizationProvider
→ future user-account authority
```

The Policy Engine and Execution Engine should not need EIP-7702-specific internals.

---

# 13. EIP-7702 MUST STAY ISOLATED FOR NOW

Do not:

```text
import EIP-7702 into strategy-yield
import EIP-7702 into strategy-lp
import EIP-7702 into health strategy
import EIP-7702 into grid strategy
rewrite Policy Engine around EIP-7702
rewrite Execution Engine around EIP-7702
make marketplace activation depend on EIP-7702
replace Altana by default
```

If needed, isolate it under:

```text
packages/eip7702/
```

Possible boundary:

```text
src/
  types.ts
  authorization.ts
  permission-model.ts
  permission-binding.ts
  delegation.ts
  verifier.ts
  executor.ts
  index.ts
```

No React/Next.js dependencies.

No LLM dependencies.

No strategy-specific dependencies.

No private keys committed to source.

---

# 14. SHARED PERMISSION MODEL

The same higher-level concepts must work for both authorization modes:

```text
User
Agent
Job
Session
Capability
Token
Protocol
Function selector
Spend allowance
Nonce
Expiry
```

Example:

```text
User
 ↓
Job #123
 ↓
Health Agent
 ↓
Capability: REPAY
 ↓
Venus
 ↓
USDT
 ↓
Max total: 1,000
 ↓
Max tx: 250
 ↓
Expiry
```

The authorization layer consumes this bounded BAN permission model.

It must not invent a competing permission system.

---

# 15. FOUR-AGENT RUNTIME

All four agents remain deterministic-first:

```text
Observe
 ↓
Deterministic strategy
 ↓
Candidate
 ↓
AI chooses among bounded candidates
 ↓
ActionProposal
 ↓
Policy
 ↓
Spend reservation
 ↓
Preflight
 ↓
Execution
```

LLM must never:

```text
invent contract addresses
invent selectors
invent unrestricted tools
receive private keys
bypass Policy
bypass spend limits
execute arbitrary RPC
```

---

# 16. EXAMPLES

## Health Agent

```text
User hires Health Agent
 ↓
ERC-8183 job
 ↓
Job requires user funds
 ↓
One bounded EIP-7702 authorization
 ↓
Agent monitors Venus
 ↓
Health factor becomes dangerous
 ↓
Deterministic remediation candidate
 ↓
AI selects bounded candidate
 ↓
Policy
 ↓
Spend reservation
 ↓
Execution
 ↓
Venus
```

## Yield Agent

```text
Hire
 ↓
Job requires user funds
 ↓
Bounded authorization
 ↓
Observe approved opportunities
 ↓
Candidate selector
 ↓
AI selects candidate
 ↓
Policy
 ↓
Swap/deposit within limits
```

## LP Agent

```text
Hire
 ↓
Bounded authorization
 ↓
Read approved LP position
 ↓
Deterministic range calculation
 ↓
Candidate reposition
 ↓
Policy
 ↓
Execution
```

## Grid Agent

```text
Hire
 ↓
Bounded authorization
 ↓
Observe price
 ↓
Deterministic grid candidate
 ↓
AI selects bounded action
 ↓
Policy
 ↓
Execution
```

---

# 17. SERVICE PAYMENT EXAMPLE

If any agent needs a paid external service:

```text
Agent
 ↓
External service
 ↓
HTTP 402
 ↓
x402
 ↓
Altana operational wallet
 ↓
Payment
 ↓
Service response
 ↓
Agent continues
```

This is separate from user-fund authorization.

---

# 18. FRONTEND ROUTES

Required core routes:

```text
/
/login
/signup
/forgot-password

/dashboard

/agents
/agents/[id]

/my-agents
/my-agents/[id]

/portfolio
/history
/profile
/settings
/notifications

/protocols
/discover
```

Settings is a settings page, not a reset page.

Settings should cover:

```text
account
wallet/network
notifications
agent preferences
security
session/permission preferences
execution preferences
```

---

# 19. MARKETPLACE FLOW

```text
/agents
 ↓
discover
 ↓
filter
 ↓
open agent
 ↓
inspect identity/reputation
 ↓
inspect strategy/capabilities/risk
 ↓
hire
```

ERC-8004 external agents should be normalized into the same marketplace model.

The four BAN-native agents must remain available even if external discovery fails.

---

# 20. AGENT DETAIL

`/agents/[id]` should show real:

```text
identity
purpose
strategy
capabilities
risk
supported protocols
performance where available
status
activation requirements
permission requirements
```

For a user-fund job, show the exact requested authority before authorization.

---

# 21. MY AGENTS

Show:

```text
ACTIVE
PAUSED
PENDING
REVOKED
```

Include:

```text
agent
job
last activity
session state
permissions
spend allowance
last execution
performance where real
```

---

# 22. MY AGENT DETAIL

Show:

```text
identity
strategy
risk
status
job
session
permissions
capabilities
spend cap
expiry
activity
execution history
performance
pause
revoke
```

No fake:

```text
AI confidence
APY
P&L
holdings
allocation
```

---

# 23. DASHBOARD

Use real:

```text
active agents
confirmed executions
failed executions
pending executions
recent activity
active sessions
real performance
```

If portfolio/net-worth data is not actually available:

```text
No data yet
```

Never fabricate financial values.

---

# 24. PORTFOLIO

Only show real positions and valuations.

If unavailable:

```text
No active positions
Portfolio data unavailable
```

---

# 25. HISTORY

Use real:

```text
executions
transactions
agent
job
protocol
status
timestamp
tx hash
```

---

# 26. PROFILE

Use authenticated user data only.

---

# 27. POLICY ENGINE

M5 remains authoritative in:

```text
packages/policy-engine
```

Do not duplicate it in the frontend or EIP-7702 package.

Policy must fail closed and validate applicable:

```text
user
agent
job/session
capability
risk
token
protocol
contract
function selector
spend
expiry
```

---

# 28. SPEND LEDGER

Required states:

```text
RESERVED
COMMITTED
RELEASED
```

Before execution:

```text
committed
+ reserved
+ requested amount
≤ authorized allowance
```

Success:

```text
RESERVED → COMMITTED
```

Failure/cancellation:

```text
RESERVED → RELEASED
```

Concurrency must not permit allowance overrun.

---

# 29. EXECUTION ENGINE

Preserve:

```text
proposal
→ validate
→ policy
→ idempotency
→ preflight/simulation
→ queue
→ executor
→ session/auth
→ sign/send
→ receipt
→ verify
→ persist
```

States:

```text
PROPOSED
EXECUTING
CONFIRMING
CONFIRMED
FAILED
```

Use `proposal.parameters`, not stale `proposal.params`.

Keep submission and reconciliation behind interfaces.

---

# 30. PROTOCOL REGISTRY

Use the existing registry for:

```text
protocols
contracts
tokens
deployments
ABIs
function selectors
```

Never scatter raw addresses through strategies, AI prompts or UI.

---

# 31. FIRESTORE + INNGEST

Firestore remains control-plane state.

Inngest remains the durable agent scheduler/queue.

Do not replace Inngest with Vercel cron.

Blockchain remains the source of on-chain truth.

---

# 32. MAINNET REQUIREMENTS

Before mainnet:

### Protocol safety

```text
verified token addresses
verified protocol addresses
verified selectors
verified ABIs
correct chain IDs
```

### Execution

```text
policy
spend reservation
idempotency
preflight
submission
reconciliation
commit/release
```

### User-fund authorization

```text
job binding
agent binding
capability binding
protocol allowlist
function allowlist
token allowlist
max transaction
total allowance
expiry
nonce/replay protection
revocation
```

### Runtime

```text
real observations
real decisions
bounded candidates
durable scheduling
retries
concurrency protection
```

### UI

```text
no mock financial values
hire works
authorization review works
activation works
execution status updates
history updates
revoke/pause works
```

---

# 33. TESTING

Run:

```bash
pnpm typecheck
pnpm test
pnpm build:packages
pnpm build
```

Never report green status unless commands actually ran successfully.

Test:

### ERC-8004

```text
normalization
missing reputation
invalid external data
API failure
native-agent fallback
```

### ERC-8183

```text
create
fund
submit
evaluate
settle
failure
expiry
```

### x402

```text
402 response
payment creation
verification
success
rejection
spend limit
```

### EIP-7702

```text
authorization
permission binding
job binding
nonce/replay protection
expiry
revocation
spend limits
protocol limits
function-selector limits
```

Keep EIP-7702 tests isolated from current Altana tests.

---

# 34. IMPLEMENTATION PRIORITY

## P0

```text
Marketplace
→ four agents
→ agent detail
→ hire
→ activate
```

## P0

```text
Observe
→ Decide
→ Proposal
→ Policy
→ Reserve
→ Preflight
→ Execute
→ Confirm
→ Persist
```

## P0

```text
Altana
→ agent operational wallet
→ one real bounded service-payment/operational path
```

## P1

```text
ERC-8004
→ discovery / identity / reputation
```

## P1

```text
ERC-8183
→ one real job lifecycle
```

## P1

```text
x402
→ one real agent-to-service payment
```

## P2

```text
EIP-7702
→ isolated user-fund authorization
→ testnet validation
→ security review
→ explicit feature enablement only after validation
```

Do not delay the core marketplace simply to make EIP-7702 production-ready.

---

# 35. FINAL ARCHITECTURE

```text
                         BAN MARKETPLACE
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
          ERC-8004           ERC-8183            x402
        DISCOVER/TRUST      HIRE/FULFILL      PAY SERVICES
              │                 │                 │
              └─────────────────┼─────────────────┘
                                ▼
                           BAN AGENTS
                                │
                         OBSERVE / DECIDE
                                │
                         ACTION PROPOSAL
                                │
                          POLICY ENGINE
                                │
                          SPEND LEDGER
                                │
                         EXECUTION ENGINE
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                 ALTANA                 EIP-7702
               CURRENT                  FUTURE
                    │                       │
           agent operational wallet   user-wallet authority
                    │                       │
                    └───────────┬───────────┘
                                ▼
                             BNB CHAIN
```

## FINAL PRODUCT STORY

```text
DISCOVER
 ↓
TRUST
 ↓
HIRE
 ↓
CREATE JOB
 ↓
Does the job require user funds?
 ├── NO
 │    ↓
 │  Agent uses Altana for its operational needs
 │
 └── YES
      ↓
   User reviews exact permissions
      ↓
   ONE EIP-7702 authorization
      ↓
   Agent performs approved skills
      ↓
   Policy guards every action
      ↓
   Execute
      ↓
   Fulfill
      ↓
   ERC-8183 settles/closes job
      ↓
   BAN invalidates/revokes job-scoped authority
      ↓
   User's remaining assets stay with the user
```

## FINAL RULE

**Altana handles the agent's operational wallet needs. EIP-7702 is reserved for jobs where the agent genuinely needs bounded authority to act on user-owned funds. ERC-8004 handles discovery/trust, ERC-8183 handles jobs/fulfillment/settlement, and x402 handles machine-to-machine service payments. BAN Policy Engine, Spend Ledger and Execution Engine remain the security and execution backbone.**

Do not silently change this model. Before modifying existing interfaces, inspect the repository and identify the exact affected files and dependencies.
