# BAN — UPDATE.md
## Authoritative Implementation Plan: Hackathon MVP + Future EIP-7702 Isolation

**Date:** 2026-09-01  
**Repository:** `ban-smart-money` / `open-agent-network`  
**Current milestone:** M15  
**Primary objective:** Make BAN a complete, real, demonstrable BNB Chain agent marketplace while preserving the existing M1–M15 architecture.

---

# 0. CODING AGENT: READ THIS FIRST

This file is the current implementation direction.

The most important decision is:

> **Do NOT replace the current Altana/session execution architecture with EIP-7702 now.**

EIP-7702 is a **future execution/authorization mode**.

The immediate hackathon priority is:

```text
Marketplace
→ Discovery
→ Understand agent
→ Hire
→ Authorize
→ Activate
→ Observe
→ Decide
→ Policy
→ Execute
→ Confirm
→ Persist
→ Monitor / Revoke
```

The four BAN-native agents are:

1. Yield Optimisation
2. Health Factor Monitoring
3. LP Rebalancing
4. Grid Trading

All four must be first-class marketplace agents.

The hackathon submission must prioritize a complete user-facing journey and real execution over adding experimental architecture that is not visible to the judge.

---

# 1. VERIFIED CURRENT REPOSITORY STATE

The current repository already contains the major M1–M15 infrastructure.

Important packages:

```text
packages/
  schemas
  shared
  registry
  signers
  agent-core
  policy-engine
  execution-engine
  blockchain
  ai
  strategy-yield
  strategy-health
  strategy-lp
  strategy-grid
  performance-engine
```

The web application is:

```text
apps/web
```

The current project is already using:

```text
Next.js
React
Viem
Firebase / Firestore
Inngest
Altana SDK
Thirdweb
Zod
```

The current repository state confirms that:

- `@ban/policy-engine` exists
- `@ban/execution-engine` exists
- `@ban/blockchain` exists
- strategy packages exist for all four agents
- `@ban/ai` exists
- the contract/token/protocol registry exists
- Firestore contains execution/session/permission/job/spend/audit state
- the runtime already has an observe → decide → propose → policy → execute → persist loop
- per-agent Altana wallets already exist as the current execution mechanism
- `BANVault.sol` exists but is not currently wired into the runtime

These facts are from the repository snapshot and should be treated as ground truth. fileciteturn0file0L37-L50 fileciteturn0file0L84-L114

---

# 2. CURRENT SECURITY MODEL — DO NOT BREAK

The authoritative security boundary remains:

```text
AI
 ↓
ActionProposal
 ↓
Deterministic Policy Engine
 ↓
Execution Engine
 ↓
Scoped Agent/Session Authorization
 ↓
Altana Agent Wallet
 ↓
BNB Chain
```

AI is the reasoning layer.

AI is NOT the authority.

Never implement:

```text
LLM
 ↓
private key
 ↓
transaction
```

The AI must never:

- receive private keys
- sign transactions
- select arbitrary contract addresses
- invent arbitrary calldata
- bypass Policy Engine
- bypass session permissions
- bypass spend limits
- directly call RPC to execute financial actions

The existing runtime already follows the observe/decide/propose/policy/execute boundary. Preserve it. fileciteturn0file0L91-L105

---

# 3. HACKATHON PRODUCT STRATEGY

BAN should be presented as:

> **A marketplace where users discover, understand, hire, authorize, monitor and revoke autonomous BNB Chain financial agents.**

The four reference agents are:

```text
Yield Optimisation
Health Factor Monitoring
LP Rebalancing
Grid Trading
```

The marketplace should eventually support external BNB agents through ecosystem standards such as ERC-8004/related discovery infrastructure.

However:

> **Do not block the hackathon MVP on complete external-agent discovery.**

First make the four BAN-native agents excellent.

---

# 4. HACKATHON-CRITICAL USER JOURNEY

The judge must be able to perform this journey:

```text
LAND
 ↓
OPEN MARKETPLACE
 ↓
SEE FOUR AGENTS
 ↓
SELECT AGENT
 ↓
UNDERSTAND WHAT IT DOES
 ↓
SEE REAL DATA / HONEST EMPTY STATE
 ↓
HIRE / ACTIVATE
 ↓
SEE EXACT PERMISSIONS
 ↓
AUTHORIZE
 ↓
AGENT BECOMES ACTIVE
 ↓
AGENT OBSERVES
 ↓
AGENT DECIDES
 ↓
ACTION PROPOSAL
 ↓
POLICY VALIDATION
 ↓
SPEND RESERVATION
 ↓
PREFLIGHT
 ↓
EXECUTION
 ↓
ON-CHAIN CONFIRMATION
 ↓
PERSIST
 ↓
USER SEES RESULT
 ↓
USER CAN PAUSE / REVOKE
```

Every implementation decision should be evaluated against this journey.

---

# 5. FRONTEND — REMOVE FABRICATED PRODUCT DATA

The current repository snapshot identifies the marketplace/UI as the primary product surface.

Relevant routes include:

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
/profile
/protocols
/discover
/portfolio
/history
/settings
/notifications
```

fileciteturn0file0L55-L79

The frontend must consume the real APIs and runtime state.

Do not use invented values such as:

```text
$2,845.62
fake APY
fake allocations
fake holdings
fake AI confidence
fake transaction counts
fake performance
fake reasoning
fake portfolio values
```

If the backend does not have a real value:

```text
—
No data yet
No active position
No executions yet
Not available
```

This is a product requirement, not merely a coding preference.

---

# 6. REQUIRED MARKETPLACE PAGE

## `/agents`

The marketplace must show all four default BAN agents from the actual agent registry/source.

Do not maintain a separate hardcoded:

```text
BAN_SMART_MONEY_AGENTS
```

list if the actual `/api/agents`/registry can be used.

Each card should expose useful real information where available:

```text
Agent name
Category
Description
Risk
Supported protocols
Capabilities
Status
Real performance metrics when available
```

No fabricated metrics.

---

# 7. AGENT DETAIL PAGE

## `/agents/[id]`

The page should allow the user to understand the agent before hiring.

Show:

```text
Identity
Purpose
Strategy
Capabilities
Supported protocols
Risk level
Supported assets
Real performance
Current status
Activation requirements
Permission/session scope
```

Then:

```text
HIRE / ACTIVATE
```

The page must not claim that an agent can do something that the actual strategy/policy/execution layer cannot do.

---

# 8. HIRING / ACTIVATION FLOW

The activation flow must explicitly show what the user is authorizing.

Example:

```text
AGENT:
Yield Optimiser

CAPABILITIES:
Yield discovery
Swap
Deposit

TOKENS:
USDT
USDC

PROTOCOLS:
PancakeSwap
Venus

MAX PER TRANSACTION:
250 USDT

TOTAL LIMIT:
1,000 USDT

EXPIRY:
30 days
```

The exact fields should be generated from the real task/session/permission model.

Never show a vague:

```text
Allow agent to control wallet
```

Instead explain the bounded permission.

---

# 9. `/my-agents`

This is the user's control surface.

Show:

```text
ACTIVE
PAUSED
PENDING
REVOKED
```

with:

```text
agent
session
permissions
last activity
last execution
performance
```

---

# 10. `/my-agents/[id]`

This is the primary agent control/analytics page.

It should expose:

### Agent identity

```text
Name
Status
Protocol
Risk
Description
```

### Real performance

```text
Confirmed executions
Success rate
Trades
P&L where genuinely available
```

If unavailable:

```text
—
```

### Agent wallet

Current Altana agent wallet data may be displayed where available.

The repository currently provisions per-agent Altana wallets and stores their encrypted keystores. fileciteturn0file0L111-L115

### Scheduler

Display the actual Inngest heartbeat/runtime state.

Do not imply Vercel cron is running the agent.

The repository uses Inngest scheduling. fileciteturn0file0L117-L121

### Tasks

Show actual task configuration:

```text
max tx
daily limit
risk
tokens
protocols
expiry
status
last run
```

### Permissions

Show:

```text
session ID
session status
spend cap
max transaction
allowed functions
allowed contracts
allowed tokens
expiry
```

### Live activity

Show actual:

```text
AGENT_ACTIVATED
AGENT_OBSERVED
AI_DECISION_CREATED
AGENT_PASSED
AGENT_TICK
AGENT_POLICY_DENIED
AGENT_PROPOSED
AGENT_EXECUTION_PENDING
execution events
```

The repository already persists these event types. fileciteturn0file0L146-L147

---

# 11. DASHBOARD

## `/dashboard`

The dashboard must aggregate real backend information.

Possible real metrics:

```text
Active agents
Confirmed executions
Failed executions
Pending executions
Recent activity
Performance where available
Active sessions
```

Do not fabricate:

```text
wallet net worth
APY
asset allocation
portfolio value
```

unless those are actually derived from real position/wallet data.

---

# 12. PORTFOLIO

## `/portfolio`

The system does not automatically have complete wallet-wide portfolio data merely because an agent exists.

Therefore:

```text
real positions
→ display

no positions
→ No active positions

wallet-wide valuation unavailable
→ honest unavailable state
```

Never create fake portfolio numbers.

---

# 13. HISTORY

## `/history`

Show real:

```text
execution
transaction
agent
protocol
status
timestamp
tx hash
```

No fake history.

---

# 14. PROFILE

## `/profile`

Profile is an account/agent-management surface.

Use real authenticated user data.

Existing behavior includes agent management/deletion.

Preserve the current security flow:

```text
delete agent
 ↓
confirm
 ↓
revoke terminal/session state
 ↓
destroy agent keystore
```

---

# 15. SETTINGS

## `/settings`

Settings are NOT a reset page.

Settings should contain configuration such as:

```text
Account
Wallet/network
Notifications
Agent preferences
Security
Session/permission preferences
Execution preferences
```

Do not rename this into a reset page.

If destructive reset functionality is ever added, it must be separately and explicitly labeled.

---

# 16. NOTIFICATIONS

Only display actual system/agent events.

Examples:

```text
Agent activated
Execution confirmed
Execution failed
Permission revoked
Session expired
Policy denied
```

No generated fake alerts.

---

# 17. PROTOCOL REGISTRY

The repository already has a fail-closed registry for:

```text
protocols
contracts
tokens
deployments
ABIs
function selectors
```

and the `/protocols` page exposes registry information.

Continue using this registry.

Do NOT scatter raw contract addresses throughout:

```text
frontend
strategy packages
AI prompts
execution code
```

The correct architecture is:

```text
logical protocol/action
        ↓
registry
        ↓
verified deployment
        ↓
contract address + selector
```

---

# 18. FOUR STRATEGIES — PRESERVE CURRENT BOUNDARY

All strategies must remain:

```text
data provider
 ↓
deterministic calculator/risk model
 ↓
candidate selector
 ↓
observation builder
 ↓
strategy
 ↓
AI
```

The AI receives bounded observations/candidates.

The AI does not directly construct unrestricted blockchain operations.

## Yield

```text
YieldDataProvider
YieldNormalizer
YieldRiskModel
YieldCandidateSelector
ObservationBuilder
YieldStrategy
```

## Health

Maintain the same deterministic observation/risk/action boundary.

## LP

```text
LiquidityAdapter
LpCalculator
LpRiskModel
LpCandidateSelector
ObservationBuilder
LpStrategy
```

Tick/range calculations remain deterministic.

## Grid

Maintain deterministic grid/risk/candidate generation.

---

# 19. M5 POLICY ENGINE

M5 remains authoritative in:

```text
packages/policy-engine
```

Do not create a second policy engine in `apps/web/lib`.

The policy engine must validate:

```text
agent
user
session
capability
strategy/risk
protocol
contract
function selector
token
spend cap
```

It must fail closed.

---

# 20. SPEND LEDGER

Spend reservation is mandatory.

State model:

```text
RESERVED
COMMITTED
RELEASED
```

Before execution:

```text
committed
+
reserved
+
new amount
<=
authorized spend
```

Successful execution:

```text
RESERVED → COMMITTED
```

Failed/cancelled execution:

```text
RESERVED → RELEASED
```

Concurrency must not permit two jobs to consume the same allowance.

---

# 21. M8 EXECUTION ENGINE

Keep the execution engine framework-agnostic.

Pipeline:

```text
PROPOSAL
 ↓
VALIDATE
 ↓
POLICY
 ↓
IDEMPOTENCY
 ↓
PREFLIGHT / SIMULATION
 ↓
QUEUE
 ↓
EXECUTOR
 ↓
SESSION AUTH
 ↓
SIGN / SEND
 ↓
RECEIPT
 ↓
VERIFY
 ↓
PERSIST
```

State:

```text
PROPOSED
EXECUTING
CONFIRMING
CONFIRMED
FAILED
```

Ensure the implementation uses:

```text
proposal.parameters
```

rather than a stale `proposal.params` reference.

Do not couple the core package directly to Firestore.

Use injected repositories/adapters.

---

# 22. CURRENT ALTANA EXECUTION PATH — KEEP IT

The current runtime uses per-agent Altana wallets.

The verified flow is approximately:

```text
Agent
 ↓
Altana wallet
 ↓
Scoped session
 ↓
Policy
 ↓
Execution backend
 ↓
BNB Chain
```

The repository provisions per-agent wallets, encrypts their keys with AES-256-GCM, and stores them in Firestore. fileciteturn0file0L111-L115

This is the current hackathon execution path.

Do not replace it with EIP-7702.

The Altana path is valuable for the hackathon because it demonstrates:

```text
dedicated agent identity
scoped permissions
spend limits
expiry
real execution
revocation
```

---

# 23. BAN VAULT — CURRENT STATUS

`BANVault.sol` exists.

It is a job-escrow contract:

```text
User
 ↓
fund job
 ↓
BAN Vault holds job funds
 ↓
authorized executor
 ↓
protocol
```

However, the repository snapshot explicitly states that the Vault is currently **not wired into the execution engine**; current execution uses direct Altana protocol calls. fileciteturn0file0L127-L129

Do not silently switch the runtime to Vault execution.

If Vault work continues, treat it as a separate execution boundary and feature flag.

---

# 24. EIP-7702 — SAFELY ISOLATE FOR FUTURE USE

## THIS IS A HIGH-PRIORITY ARCHITECTURAL REQUIREMENT

The EIP-7702 work must remain isolated.

Do NOT make EIP-7702 a dependency of:

```text
strategy-yield
strategy-health
strategy-lp
strategy-grid
policy-engine
execution-engine
agent-core
```

Do NOT sprinkle EIP-7702-specific types throughout the application.

Do NOT modify the default Altana flow to require EIP-7702.

Do NOT enable it by default.

---

# 25. RECOMMENDED EIP-7702 PACKAGE BOUNDARY

If not already present, create:

```text
packages/eip7702/
```

Suggested structure:

```text
packages/eip7702/
  package.json
  tsconfig.json
  vitest.config.mts

  src/
    types.ts
    authorization.ts
    permission-model.ts
    permission-binding.ts
    delegation.ts
    verifier.ts
    executor.ts
    index.ts

  tests/
    authorization.test.ts
    permission-binding.test.ts
    verifier.test.ts
```

This package must be framework-agnostic.

No:

```text
Next.js
React
Firebase client
UI imports
LLM imports
```

inside the core EIP-7702 package.

---

# 26. ABSTRACT AUTHORIZATION INTERFACE

The rest of BAN should depend on an abstract concept rather than EIP-7702 directly.

For example:

```ts
interface AuthorizationProvider {
  prepareAuthorization(...): Promise<...>
  verifyAuthorization(...): Promise<...>
  activateAuthorization(...): Promise<...>
  revokeAuthorization(...): Promise<...>
}
```

Possible implementations:

```text
AltanaAuthorizationProvider
Eip7702AuthorizationProvider
```

Current default:

```text
AltanaAuthorizationProvider
```

Future:

```text
Eip7702AuthorizationProvider
```

The application should select this through configuration/feature flag, not imports scattered throughout the codebase.

---

# 27. EIP-7702 MUST NOT MEAN "UNLIMITED WALLET ACCESS"

The future EIP-7702 model must preserve BAN permissions.

An EIP-7702 authorization itself does not automatically encode:

```text
agent
job
token
spend limit
protocol allowlist
function selector
expiry
```

Therefore BAN-specific permission enforcement remains necessary.

Future architecture:

```text
EIP-7702 authorization
 ↓
BAN permission/session
 ↓
Policy Engine
 ↓
Spend Ledger
 ↓
Execution Engine
```

Never implement:

```text
EIP-7702
 ↓
unrestricted execution
```

---

# 28. FUTURE EIP-7702 PERMISSION MODEL

The future permission object may contain:

```text
userAddress
agentId
jobId
sessionId
chainId

allowedTokens[]
allowedProtocols[]
allowedFunctionSelectors[]
allowedCapabilities[]

maxTotalSpend
maxSpendPerTransaction
dailySpendLimit

startsAt
expiresAt

status
```

The exact cryptographic binding must be proven on BSC testnet before production use.

Do not trust an off-chain database to enforce permissions after granting a broadly privileged delegated account.

The on-chain delegated implementation must enforce or cryptographically bind the required restrictions.

---

# 29. EIP-7702 WALLET UX — FUTURE

The desired future UX is:

```text
Connect wallet
 ↓
Create job
 ↓
Review exact permissions
 ↓
ONE wallet authorization
 ↓
BAN relays activation
 ↓
Permission active
 ↓
Agent executes within limits
```

After activation, autonomous transactions should not require repeated user wallet popups, assuming the selected wallet/client and delegation architecture support the intended flow.

But do NOT ship this UX until testnet validation proves the exact implementation.

---

# 30. EIP-7702 + ERC20 APPROVAL

Do not assume:

```text
EIP-7702 authorization
=
ERC20 allowance
```

They are different authorization mechanisms.

If future delegated execution needs ERC20 token movement, implement the appropriate token authorization/allowance model explicitly.

Never automatically grant:

```text
unlimited USDT approval
```

as a side effect of EIP-7702 activation.

---

# 31. EIP-7702 FRONTEND ISOLATION

Do not put EIP-7702 calls directly inside generic UI components.

Instead:

```text
UI
 ↓
authorization service
 ↓
AuthorizationProvider
 ↓
EIP-7702 implementation
```

If a future feature flag is introduced:

```text
BAN_EXECUTION_MODE=altana
BAN_EXECUTION_MODE=eip7702
```

the default must remain:

```text
altana
```

until explicitly changed and tested.

Never expose server private keys to the browser.

---

# 32. EIP-7702 BACKEND ISOLATION

The EIP-7702 implementation may use Viem.

Keep:

```text
prepareAuthorization
signAuthorization
verifyAuthorization
authorizationList
```

inside the isolated package/service boundary.

The execution engine should see an abstract executor/authorization interface.

It should not need to know:

```text
EIP-7702 transaction tuple
delegation design
authorization signature internals
```

---

# 33. EIP-7702 TEST REQUIREMENTS BEFORE ACTIVATION

Before enabling it:

### Test 1 — delegation

```text
EOA
 ↓
authorization
 ↓
relay
 ↓
delegation active
```

### Test 2 — identity

Verify protocol interaction remains attributable to the intended user account.

### Test 3 — permissions

Example:

```text
maxTotal = 1,000 USDT
maxPerTx = 250 USDT
```

Test:

```text
200 → pass
250 → pass
251 → fail
800 cumulative → pass
201 after 800 → fail
```

### Test 4 — protocol restrictions

```text
allowed protocol/function → pass
unauthorized function → fail
unauthorized protocol → fail
```

### Test 5 — expiry

```text
before expiry → pass
after expiry → fail
```

### Test 6 — replay

Reusing the authorization/nonce incorrectly must fail.

### Test 7 — concurrency

Two simultaneous executions must not exceed the allowance.

### Test 8 — revocation

Revoked permission/delegation must prevent future execution.

Do not make EIP-7702 the default until these are passing on BSC testnet.

---

# 34. ERC-8004 — FUTURE MARKETPLACE DISCOVERY

Design the marketplace so external agents can eventually be represented by the same normalized model.

Conceptually:

```text
ERC-8004
 ↓
identity
 ↓
capabilities
 ↓
reputation
 ↓
ownership
 ↓
activity
 ↓
BAN discovery/ranking
```

Do not make this block the four-agent MVP.

---

# 35. ERC-8183 — FUTURE HIRING

Future marketplace:

```text
BAN
 ↓
external agent discovery
 ↓
ERC-8183 task/hire
 ↓
agent
```

First prove BAN-native hiring.

Then integrate external task/hiring standards.

---

# 36. X402 / B402 — OPTIONAL

Treat payment protocols as an optional ecosystem integration.

Do not make them a core dependency of the agent runtime.

---

# 37. REAL DATA PATH

The repository has:

```text
LiveDataProvider
DevDataProvider
```

The development provider should remain deterministic and hermetic.

Live mode should explicitly use configured BNB chain/RPC data.

Do not silently mix development fixtures with mainnet data.

---

# 38. NETWORK SAFETY

Explicitly distinguish:

```text
BSC Testnet = 97
BSC Mainnet = 56
```

Never infer production network from UI labels.

Never silently submit a mainnet transaction.

Environment configuration must be explicit.

---

# 39. ENVIRONMENT / SECRETS

Server-only secrets include:

```text
BAN_RPC_URL
BAN_BNB_PRIVATE_KEY
BAN_KEYSTORE_ENCRYPTION_KEY
FIREBASE_PRIVATE_KEY
OPENROUTER_API_KEY
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
```

Never expose these through:

```text
NEXT_PUBLIC_*
```

Never send private keys to the AI.

---

# 40. REAL-TIME AGENT LOOP

The agent runtime should remain:

```text
OBSERVE
 ↓
DECIDE
 ↓
PROPOSE
 ↓
POLICY
 ↓
EXECUTE
 ↓
PERSIST
```

The current runtime also honestly handles configuration gaps by reporting `awaited` rather than fabricating a successful execution. Preserve this behavior. fileciteturn0file0L91-L105

---

# 41. INNGEST

Inngest remains the durable scheduler/queue layer.

Do not replace it with Vercel cron.

Current architecture includes:

```text
agent observation
agent decision
agent execution
market data
position sync
performance
```

and periodic agent ticks.

Preserve durable retries/concurrency/dead-letter behavior.

---

# 42. FIRESTORE

Firestore is application/control-plane state.

Relevant collections include:

```text
users
agents
agent_sessions
agent_permissions
strategies
action_proposals
executions
jobs
spend_ledger
positions
market_data
performance
audit_events
agent_events
protocol_configs
agent_tasks
agent_keystores
```

fileciteturn0file0L84-L89

Do not treat Firestore as blockchain truth.

Use:

```text
Blockchain = on-chain truth
Firestore = application/control-plane state
```

---

# 43. MAINNET READINESS CHECKLIST

Before calling BAN usable on mainnet:

## Contracts

- [ ] Every contract address verified.
- [ ] Every token address verified.
- [ ] Every selector verified.
- [ ] Protocol registry seeded from authoritative deployment sources.
- [ ] Testnet and mainnet addresses cannot be confused.

## Execution

- [ ] Policy validation works.
- [ ] Spend reservation is atomic.
- [ ] Idempotency works.
- [ ] Preflight works.
- [ ] Transaction submission works.
- [ ] Receipt reconciliation works.
- [ ] Failed transactions release reservations.
- [ ] Successful transactions commit reservations.

## Sessions

- [ ] Sessions have bounded permissions.
- [ ] Expiry enforced.
- [ ] Revocation enforced.
- [ ] Call allowlist enforced.
- [ ] Spend cap enforced.

## Runtime

- [ ] Inngest loop works.
- [ ] Agent observation works.
- [ ] AI decision works.
- [ ] Deterministic candidate generation works.
- [ ] Policy blocks unsafe actions.
- [ ] Real transaction confirms.

## UI

- [ ] No mock/test data used as product truth.
- [ ] Four agents visible.
- [ ] Hiring works.
- [ ] Activation works.
- [ ] Status updates.
- [ ] Execution history updates.
- [ ] User can revoke/pause.
- [ ] Empty/error/loading states work.

---

# 44. TESTING RULE

Every core change requires tests.

At minimum run:

```bash
pnpm typecheck
pnpm test
pnpm build:packages
pnpm build
```

Where package scripts exist, also run targeted package tests.

Do not claim green status without actually running the commands.

---

# 45. SAFE CHANGE PROTOCOL FOR THE CODING AGENT

Before modifying a file:

1. Read the existing implementation.
2. Identify the authoritative source of truth.
3. Search for all callers/imports.
4. Determine whether the feature is already implemented elsewhere.
5. Reuse existing interfaces.
6. Avoid duplicate business logic.
7. Make the smallest change that satisfies the milestone.
8. Add/adjust tests.
9. Run targeted tests.
10. Run typecheck.
11. Run root tests.
12. Run build.
13. Report exactly what changed.

Do not rewrite large files blindly.

Do not delete apparently unused code until imports/runtime references have been checked.

---

# 46. DO NOT DO THESE THINGS

Do not:

```text
❌ Replace Altana with EIP-7702 now
❌ Put EIP-7702 imports throughout the repo
❌ Create a second policy engine
❌ Create a second execution engine
❌ Reintroduce fake dashboard numbers
❌ Reintroduce fake marketplace agents
❌ Let AI select arbitrary contracts
❌ Let AI construct unrestricted calldata
❌ Give AI private keys
❌ Give agents unlimited token approvals
❌ Skip SpendLedger
❌ Skip preflight where required
❌ Treat Firestore as blockchain truth
❌ Use Vercel cron instead of Inngest
❌ Silently switch testnet/mainnet
❌ Claim execution succeeded without a real receipt
```

---

# 47. IMPLEMENTATION PRIORITY

If time is limited, use this exact order:

## PRIORITY 1 — Marketplace

```text
/agents
/agents/[id]
hire
activate
```

## PRIORITY 2 — Four complete agents

```text
Yield
Health
LP
Grid
```

## PRIORITY 3 — Real data

```text
registry
blockchain
performance
activity
execution
```

## PRIORITY 4 — End-to-end live loop

```text
hire
→ session
→ observe
→ decide
→ proposal
→ policy
→ reserve
→ preflight
→ execute
→ confirm
→ persist
→ UI
```

## PRIORITY 5 — Altana demonstration

Prove a real bounded transaction through the current Altana/session architecture.

## PRIORITY 6 — Ecosystem discovery

```text
ERC-8004
```

## PRIORITY 7 — External hiring

```text
ERC-8183
```

## PRIORITY 8 — Optional payments

```text
x402 / B402
```

## PRIORITY 9 — EIP-7702

Only after the above is stable.

---

# 48. FINAL ARCHITECTURE

The near-term authoritative architecture is:

```text
                         USER
                          │
                          ▼
                   BAN MARKETPLACE
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
           DISCOVER     EVALUATE     HIRE
              │           │           │
              └───────────┼───────────┘
                          ▼
                       SESSION
                          │
                          ▼
                    AGENT RUNTIME
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
              OBSERVE            DECIDE
                 │                 │
                 └────────┬────────┘
                          ▼
                    ACTION PROPOSAL
                          │
                          ▼
                    POLICY ENGINE
                          │
                    SPEND LEDGER
                          │
                          ▼
                  EXECUTION ENGINE
                          │
                          ▼
                     ALTANA
                  AGENT WALLET
                          │
                          ▼
                      BNB CHAIN
                          │
                          ▼
                    DeFi Protocols
```

Future:

```text
                  EXECUTION ENGINE
                         │
                 ┌───────┴────────┐
                 ▼                ▼
              ALTANA          EIP-7702
              DEFAULT           FUTURE
```

The core BAN architecture must not care which authorization/execution backend is eventually selected.

---

# 49. FINAL EIP-7702 ISOLATION RULE

The coding agent's job right now is NOT to finish EIP-7702.

The job is to make sure the architecture can support it later **without a rewrite**.

Therefore:

```text
EIP-7702 code
    ↓
isolated package
    ↓
abstract provider interface
    ↓
feature flag / dependency injection
```

while the active system remains:

```text
Altana
```

This is the safest way to preserve the one-wallet-pop EIP-7702 concept for future BAN versions without risking the current hackathon submission.

---

# 50. DEFINITION OF DONE

The immediate BAN hackathon MVP is done when a judge can:

```text
Open BAN
 ↓
Discover four agents
 ↓
Understand any agent
 ↓
Hire one
 ↓
See exact permissions
 ↓
Authorize
 ↓
Agent becomes active
 ↓
Agent observes real data
 ↓
Agent reasons over bounded candidates
 ↓
Policy validates the action
 ↓
Spend is reserved
 ↓
Transaction is executed
 ↓
Transaction confirms
 ↓
Spend is committed
 ↓
Result appears in BAN
 ↓
User can monitor
 ↓
User can pause/revoke
```

And the repository remains architecturally ready for:

```text
ERC-8004 discovery
ERC-8183 hiring
x402/B402
EIP-7702 user-wallet execution
```

without destabilizing the current Altana-based system.

---

# SOURCE / REPOSITORY GROUND TRUTH

The repository snapshot used for this update explicitly records the current product identity, security model, packages, UI routes, API routes, Firestore collections, agent runtime, Altana wallet architecture, Inngest scheduling, Vault status, and known gaps. fileciteturn0file0L9-L18 fileciteturn0file0L21-L34 fileciteturn0file0L71-L79 fileciteturn0file0L117-L129

**This document is the implementation direction to follow unless a newer `UPDATE.md` explicitly supersedes it.**
