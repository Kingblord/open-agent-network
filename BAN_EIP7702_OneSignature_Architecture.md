# BAN — EIP-7702 One-Signature Autonomous Agent Architecture

**Status:** Proposed implementation update  
**Date:** 2026-09-01  
**Target:** BNB Smart Chain (BSC), with testnet-first validation  
**Product:** BAN Smart Money / BNB Agent Network

---

## 1. Executive decision

BAN will **not combine EIP-712 Job Authorization with a separate user-facing EIP-7702 authorization**.

The target UX is:

> **One wallet authorization during first-time BAN onboarding; after that, BAN agents can execute permitted transactions without another user wallet popup, while the user's funds remain in the user's own account and protocols see the user's address.**

The mechanism selected for investigation and implementation is **EIP-7702 delegated EOA execution**, with a purpose-built BAN permission implementation.

This replaces the previous plan in which a normal EOA signed an EIP-712 job authorization but still had to sign each real blockchain transaction.

### Critical terminology

EIP-7702's authorization is **not an EIP-712 typed-data signature**. It is an EIP-7702 authorization tuple containing:

- `chain_id`
- delegated `contract_address`
- account `nonce`
- signature fields

The user-facing requirement is therefore called **one wallet authorization**, not "one EIP-712 signature".

---

# 2. Verification results

## 2.1 BNB Smart Chain support — VERIFIED

BNB Chain's official Pascal hardfork documentation states:

- BSC testnet Pascal: **2025-02-25**
- BSC mainnet Pascal: **2025-03-20**
- Pascal includes **BEP-441: Implement EIP-7702: Set EOA account code**

Therefore EIP-7702 is part of BSC's protocol upgrade path and is not merely an Ethereum-only feature.

**Source:** BNB Chain Pascal upgrade documentation:
https://docs.bnbchain.org/announce/pascal-bsc/

---

## 2.2 What EIP-7702 actually does — VERIFIED

The official EIP defines a new transaction type that lets an EOA set a delegation indicator pointing to implementation code.

The authorization tuple is:

`[chain_id, address, nonce, y_parity, r, s]`

The EOA remains the account/address, while its code delegates to the specified implementation.

This is the important property for BAN:

```text
User EOA
0xUSER

delegates execution to:

BAN Permission Implementation
```

The user does **not** become a new shared BAN contract identity.

**Source:** EIP-7702:
https://eips.ethereum.org/EIPS/eip-7702

---

## 2.3 Viem support — VERIFIED

The repository already uses `viem ^2.55`.

Viem provides native EIP-7702 APIs including:

- `prepareAuthorization`
- `signAuthorization`
- `verifyAuthorization`
- transaction `authorizationList`
- EIP-7702 contract writes
- EIP-7702 transaction sending
- EIP-7702 simulation

Viem documents that after the EOA has been delegated, subsequent interactions with the delegated account no longer need to include the authorization again.

This means BAN does not need to hand-build the authorization tuple.

**Sources:**

https://viem.sh/docs/eip7702

https://viem.sh/docs/eip7702/signAuthorization

https://viem.sh/docs/eip7702/sending-transactions

---

# 3. The problem with our old architecture

The previous design was:

```text
User
  ↓
EIP-712 Job Authorization
  ↓
BAN
  ↓
Agent proposes transaction
  ↓
User EOA must sign actual transaction
  ↓
Protocol
```

That does NOT produce autonomous execution.

EIP-712 can prove:

> "The user authorized this job."

But an ordinary EOA still needs its private-key signature to originate an actual transaction.

Therefore:

**EIP-712-only = NOT sufficient for BAN's desired UX.**

---

# 4. New BAN architecture

The new execution model is:

```text
                     USER EOA
                  0xABC...123
                       │
                       │ ONE EIP-7702
                       │ authorization
                       ▼
              BAN Permission Account
                       │
              ┌────────┴────────┐
              │ BAN permission  │
              │ enforcement     │
              └────────┬────────┘
                       │
                 Agent proposal
                       │
                       ▼
                 Policy Engine
                       │
                 Spend Ledger
                       │
                       ▼
                 BAN Executor
                       │
                       ▼
                  USER EOA
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
        Venus      PancakeSwap     Other
```

The important distinction is:

```text
BAN Vault model:

User → BAN Vault → Protocol

Protocol sees BAN Vault
```

versus:

```text
BAN delegated-account model:

User EOA → Protocol

Protocol sees user's EOA
```

The second model matches the new BAN requirement.

---

# 5. One-time onboarding goal

The desired user experience is:

### First use

```text
Connect wallet
      ↓
Choose agent
      ↓
Configure job
      ↓
Review permission
      ↓
"Authorize BAN"
      ↓
ONE wallet authorization
      ↓
BAN becomes active
```

After successful activation:

```text
Agent observes
      ↓
AI reasons
      ↓
ActionProposal
      ↓
Policy Engine
      ↓
Permission validation
      ↓
Spend reservation
      ↓
Execution
      ↓
Protocol
```

User wallet popups:

**0**

for subsequent autonomous transactions.

---

# 6. Critical design constraint: EIP-7702 alone does not contain BAN limits

This is extremely important.

An EIP-7702 authorization contains only the delegation information required by the protocol.

It does NOT natively contain:

- agent ID
- job ID
- token limit
- protocol allowlist
- function selector allowlist
- per-transaction cap
- daily cap
- expiry
- BAN capability

Therefore we must not pretend that:

```text
EIP-7702 authorization
=
BAN job permission
```

They are different concepts.

The one-signature requirement means the BAN implementation must bind the user's authorization to the permission configuration **without asking for a second user signature**.

---

# 7. Recommended one-signature permission construction

For the hackathon, use a **permission-specific delegated implementation**.

The EIP-7702 authorization points to a BAN permission implementation address whose configuration is immutable/bound to the requested job.

Conceptually:

```text
BAN Permission Implementation
       │
       ├── owner/user
       ├── jobId
       ├── agentId
       ├── token
       ├── maxTotal
       ├── maxPerTx
       ├── expiry
       ├── protocol allowlist
       └── selector allowlist
```

The authorization therefore selects the exact implementation/configuration that the user is agreeing to delegate to.

### Important

Do NOT deploy arbitrary mutable permission contracts and allow a relayer to choose their configuration after the user signs.

The implementation/configuration must be cryptographically and deterministically bound to the intended permission set.

A practical implementation can use a deterministic deployment/factory scheme:

```text
permission config
      ↓
configuration hash
      ↓
CREATE2-derived permission implementation
      ↓
EIP-7702 authorization targets that address
```

The exact factory/clone architecture should be finalized after testnet contract experiments.

---

# 8. Why a shared BAN contract cannot be the protocol identity

The user explicitly requires that users remain identifiable as themselves to protocols.

Therefore BAN must NOT use:

```text
User A ─┐
User B ─┼──> BAN Executor Contract ──> Venus
User C ─┘
```

because the protocol may associate positions/permissions with the BAN contract.

Instead:

```text
User A → Venus as User A
User B → Venus as User B
User C → Venus as User C
```

EIP-7702 is suitable for this model because the delegated code executes in the context of the user's account.

---

# 9. BAN backend architecture

The existing BAN backend already has most of the control-plane pieces required.

Current verified repository components include:

- `@ban/schemas`
- `@ban/policy-engine`
- `@ban/execution-engine`
- `@ban/blockchain`
- `@ban/agent-core`
- `@ban/ai`
- strategy packages
- Firebase/Firestore
- Inngest
- Viem
- per-agent Altana infrastructure

The current agent runtime is:

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

This is already the correct logical pipeline.

The change is primarily the **execution identity and signing boundary**.

---

# 10. New backend modules

Create:

```text
packages/permissions/
  src/
    types.ts
    permission-hash.ts
    permission-registry.ts
    verifier.ts
    index.ts
```

and/or:

```text
packages/eip7702/
  src/
    authorization.ts
    delegation.ts
    verifier.ts
    index.ts
```

Recommended separation:

```text
@ban/eip7702
    ↓
EIP-7702 protocol mechanics

@ban/permissions
    ↓
BAN-specific authorization model

@ban/policy-engine
    ↓
proposal authorization

@ban/execution-engine
    ↓
transaction lifecycle
```

Do not put all of this into `apps/web`.

---

# 11. Shared schemas

Extend `@ban/schemas` with:

```text
DelegationAuthorization
```

Fields:

```text
userAddress
chainId
delegateAddress
nonce
authorizationHash
status
createdAt
activatedAt
revokedAt
```

Add:

```text
AgentPermission
```

Fields:

```text
userId
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

Add:

```text
PermissionSpend
```

Fields:

```text
permissionId
jobId
executionId
token
amount
status
createdAt
```

---

# 12. Firestore model

The existing Firestore already contains:

```text
agent_permissions
action_proposals
executions
jobs
spend_ledger
audit_events
agent_sessions
```

Use these rather than introducing duplicate state.

Recommended permission record:

```text
agent_permissions/{permissionId}

{
  userAddress,
  agentId,
  jobId,
  sessionId,

  chainId,
  delegateAddress,

  allowedTokens,
  allowedProtocols,
  allowedFunctionSelectors,
  allowedCapabilities,

  maxTotalSpend,
  maxSpendPerTransaction,
  dailySpendLimit,

  expiresAt,
  status,

  authorizationHash,
  authorizationNonce,

  createdAt,
  activatedAt,
  revokedAt
}
```

Firestore is the **control-plane record**.

The delegated EOA implementation is the **on-chain enforcement boundary**.

The two must never disagree.

---

# 13. Frontend onboarding flow

Add a dedicated onboarding screen/modal.

Route can be:

```text
/agents/[id]/authorize
```

or a modal from:

```text
/my-agents/[id]
```

### Screen 1 — Review

Show:

```text
AUTHORIZE BAN

Agent
Yield Optimizer

Token
USDT

Maximum total
1,000 USDT

Maximum per transaction
250 USDT

Protocols
PancakeSwap
Venus

Capabilities
SWAP
DEPOSIT
WITHDRAW

Expires
30 days
```

Never show vague language such as:

> "Give BAN access to your wallet."

The permission must be explicit.

---

# 14. Frontend authorization call

Use Viem's EIP-7702 support.

Conceptual client flow:

```ts
const authorization =
  await walletClient.signAuthorization({
    account,
    contractAddress: banDelegateAddress,
    chainId: 56,
    nonce,
  })
```

Viem exposes `signAuthorization` specifically for creating the EIP-7702 authorization object.

Then submit the signed authorization through the BAN relay/onboarding endpoint.

The frontend should NOT construct raw authorization RLP/signatures manually.

---

# 15. Important wallet-popup reality

The protocol gives BAN a signed authorization object.

A relayer can submit the EIP-7702 transaction, meaning the user does not necessarily need to pay gas for the activation transaction.

Viem explicitly supports an executor/relayer model for EIP-7702 authorization.

Therefore BAN can target:

```text
User signs once
       ↓
BAN receives authorization
       ↓
BAN relayer submits transaction
       ↓
delegation becomes active
```

After activation, subsequent transactions interact with the delegated account without including the authorization again.

---

# 16. API routes

Add:

```text
POST /api/permissions/prepare
POST /api/permissions/authorize
GET  /api/permissions/[id]
POST /api/permissions/[id]/revoke
GET  /api/agents/[id]/permissions
```

### `/api/permissions/prepare`

Server creates the exact permission configuration.

Returns:

```json
{
  "permissionId": "...",
  "jobId": "...",
  "agentId": "...",
  "chainId": 56,
  "delegateAddress": "0x...",
  "nonce": 12,
  "expiresAt": "...",
  "limits": {
    "maxTotal": "...",
    "maxPerTransaction": "..."
  },
  "allowedProtocols": ["..."],
  "allowedSelectors": ["..."]
}
```

The frontend displays this exact configuration.

---

# 17. `/api/permissions/authorize`

Accept:

```text
permissionId
signedAuthorization
```

Server:

1. Authenticate the logged-in user.
2. Load the pending permission.
3. Verify the EIP-7702 authorization signature.
4. Verify recovered authority equals `userAddress`.
5. Verify chain ID.
6. Verify delegate address.
7. Verify nonce.
8. Verify the expected configuration/delegate binding.
9. Submit/relay the activation transaction.
10. Wait for receipt or record pending state.
11. Confirm delegation.
12. Mark permission `ACTIVE`.
13. Create audit event.
14. Activate the associated job/session.

Never mark the permission active solely because the API received a signature.

---

# 18. Agent runtime integration

Current:

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
```

New:

```text
OBSERVE
 ↓
DECIDE
 ↓
PROPOSE
 ↓
POLICY
 ↓
PERMISSION
 ↓
SPEND RESERVATION
 ↓
PREFLIGHT
 ↓
EXECUTE
 ↓
RECONCILE
 ↓
COMMIT/RELEASE
 ↓
PERSIST
```

The AI remains unchanged.

AI is still:

```text
brain only
```

It does not receive:

- private keys
- EIP-7702 authorization
- raw signing authority
- arbitrary contract execution
- unrestricted calldata authority

---

# 19. Policy Engine changes

The Policy Engine must verify both:

### BAN application policy

```text
agent
session
capability
strategy
risk
protocol
contract
function selector
token
spend cap
```

and:

### On-chain permission

```text
user
job
delegate
token
protocol
selector
amount
expiry
```

A proposal is executable only when both layers pass.

```text
Application Policy
       AND
On-chain Permission
       AND
Spend Reservation
       ↓
ALLOW
```

Fail closed if permission state is missing or uncertain.

---

# 20. SpendLedger remains mandatory

EIP-7702 does NOT replace SpendLedger.

The ledger remains:

```text
RESERVED
   ↓
COMMITTED
```

or:

```text
RESERVED
   ↓
RELEASED
```

Before execution:

```text
alreadyReserved
+
newReservation
<=
authorizedTotal
```

This prevents two concurrent agent jobs from both believing they can consume the same allowance.

---

# 21. Execution Engine

The existing execution pipeline should become:

```text
PROPOSED
   ↓
VALIDATING
   ↓
AUTHORIZED
   ↓
RESERVED
   ↓
PREFLIGHT
   ↓
QUEUED
   ↓
EXECUTING
   ↓
CONFIRMING
   ↓
CONFIRMED
```

Failure:

```text
FAILED
```

The execution backend changes from:

```text
Agent wallet / Altana
```

to:

```text
BAN EIP-7702 delegated-account executor
```

for user-wallet autonomous jobs.

The old per-agent Altana wallet path can remain as a separate execution mode during migration, but it must not silently execute a user-wallet job.

---

# 22. Executor model

The relayer/executor is NOT the user's identity.

It is only the transaction submitter.

Conceptually:

```text
Relayer
   │
   │ submits transaction
   ▼
User EOA
   │
   │ delegated BAN code
   ▼
Target protocol
```

This distinction must be preserved in all data models.

Never store:

```text
executorAddress = userAddress
```

unless that is actually true.

Store separately:

```text
userAddress
authorityAddress
relayerAddress
targetAddress
```

---

# 23. Protocol call flow

Example: User authorizes Health Agent for Venus.

```text
User
  │
  │ one-time EIP-7702 authorization
  ▼
BAN delegated account
  │
  │
Health Agent
  │
  │ observes user's Venus position
  ▼
AI
  │
  │ proposes:
  │ repay 200 USDT
  ▼
ActionProposal
  │
  ▼
Policy Engine
  │
  ├─ correct user
  ├─ correct job
  ├─ Health capability
  ├─ Venus allowed
  ├─ selector allowed
  ├─ USDT allowed
  ├─ 200 <= per-tx limit
  └─ total spend within limit
  │
  ▼
SpendLedger RESERVE 200
  │
  ▼
Preflight simulation
  │
  ▼
Relayer submits
  │
  ▼
User's delegated EOA
  │
  ▼
Venus
  │
  ▼
receipt
  │
  ▼
SpendLedger COMMIT
```

The protocol should see the user's account as the relevant account.

---

# 24. User balance remains in wallet

No BAN Vault deposit is required for this execution mode.

Example:

```text
User wallet
10,000 USDT

BAN permission
max total = 1,000 USDT
```

BAN does NOT move the 1,000 USDT into a common vault.

The remaining:

```text
9,000 USDT
```

remains outside the permitted spend.

The permission implementation must enforce the exact asset/action boundaries.

---

# 25. Do not use the old BANVault for this mode

The repository currently contains `BANVault.sol`, but the current codebase does not wire it into execution.

The repository snapshot explicitly describes the Vault as a job-escrow model where the Vault holds user funds for a task/job.

That is incompatible with the primary user-wallet execution model described here.

Therefore:

```text
BAN Vault = optional escrow/custody mode

EIP-7702 = primary autonomous user-wallet mode
```

Do not make Vault execution a prerequisite for EIP-7702 jobs.

---

# 26. UI changes

### Agent detail

Replace:

```text
CREATE TASK
```

with an authorization-aware flow:

```text
CREATE JOB
   ↓
CONFIGURE PERMISSION
   ↓
AUTHORIZE BAN
   ↓
ACTIVE
```

### Permissions card

Display:

```text
BAN ACCESS

Status: ACTIVE

Authorized:
USDT
1,000 total
250 / transaction

Protocols:
Venus
PancakeSwap

Expires:
Sep 30, 2026

[VIEW PERMISSIONS]
[REVOKE]
```

### Revoke

The UI must clearly distinguish:

```text
Pause Agent
```

from:

```text
Revoke Wallet Delegation
```

Pausing stops BAN's agent loop.

Revoking/removing the delegation disables the delegated execution mechanism.

Because EIP-7702 authorization/delegation is an account-level operation, the exact revocation flow must be tested on the target BSC wallet/client before exposing it as a one-click product feature.

---

# 27. Marketplace flow

The marketplace remains:

```text
/
 ↓
/agents
 ↓
/agents/[id]
 ↓
Hire
 ↓
Create Job
 ↓
Configure limits
 ↓
Authorize BAN
 ↓
/my-agents/[id]
```

The marketplace must never claim:

> "Agent can control your wallet."

Instead:

> "Authorize this agent to perform these specific actions within these limits."

---

# 28. Security requirements

## MUST

- Verify EIP-7702 authorization against the expected user address.
- Verify chain ID.
- Verify authorization nonce.
- Verify delegate address.
- Bind permission configuration to the authorized delegation.
- Fail closed when permission state is unavailable.
- Enforce token allowlists.
- Enforce protocol allowlists.
- Enforce function-selector allowlists.
- Enforce per-transaction limits.
- Enforce cumulative limits.
- Enforce expiry.
- Use SpendLedger reservations.
- Prevent replay.
- Prevent concurrent double-spend.
- Simulate before execution where supported.
- Record every execution and permission event.
- Never expose private keys to AI.
- Never allow arbitrary AI-generated contract addresses.
- Never allow arbitrary selectors/calldata without registry/policy approval.

## MUST NOT

```text
LLM → private key
LLM → arbitrary contract
LLM → arbitrary calldata
LLM → direct wallet signing
LLM → unrestricted EOA execution
```

---

# 29. Registry integration

The existing BAN registry is fail-closed.

Continue using it for:

```text
protocol
contract
token
ABI
function selector
deployment
```

The EIP-7702 permission system must reference registry identifiers rather than trusting arbitrary addresses supplied by an LLM.

Example:

```text
protocolId = VENUS
contractId = VENUS_COMPTROLLER
functionSelector = 0x...
```

The backend resolves those identifiers through the verified registry.

---

# 30. Relayer design

BAN needs a funded relayer account.

Its role is:

```text
submit transaction
pay gas
never own user funds
never become user identity
```

Environment:

```text
BAN_RELAYER_PRIVATE_KEY
BAN_RPC_URL
BAN_CHAIN_ID=56
```

The relayer key must live only server-side.

Never expose it through:

```text
NEXT_PUBLIC_*
```

The relayer should be rate-limited and monitored.

---

# 31. Gas sponsorship

The user should not need BNB for each autonomous action if BAN sponsors the transactions.

Architecture:

```text
BAN Relayer
    │
    │ pays gas
    ▼
EIP-7702 delegated user account
    │
    ▼
Protocol
```

Gas accounting should be recorded separately from token spend.

Do not accidentally interpret gas cost as the user's USDT spending allowance unless that is explicitly part of the product policy.

---

# 32. Frontend implementation stack

Already available:

```text
Next.js
React
Viem
Thirdweb
Firebase
```

Use Viem for EIP-7702 primitives.

Do not implement EIP-7702 manually in the browser.

Use:

```ts
prepareAuthorization()
signAuthorization()
```

and submit the signed authorization to the backend.

The existing wallet-connect infrastructure should be extended rather than replaced.

---

# 33. Backend implementation stack

Use:

```text
Next.js API routes
Firebase Admin
Firestore
Viem
Inngest
@ban/policy-engine
@ban/execution-engine
@ban/registry
@ban/schemas
@ban/blockchain
```

The execution worker remains Inngest-driven.

The EIP-7702 executor should be a server-side dependency of the execution engine.

---

# 34. Suggested package

Create:

```text
packages/eip7702/
```

with:

```text
src/
  authorization.ts
  delegation.ts
  executor.ts
  permission-binding.ts
  verification.ts
  errors.ts
  index.ts

tests/
  authorization.test.ts
  permission-binding.test.ts
  executor.test.ts
```

The package should contain no Firebase or Next.js dependency.

---

# 35. Suggested contract

Create:

```text
contracts/BANPermissionAccount.sol
```

Responsibilities:

- delegated account execution
- permission enforcement
- nonce/replay protection
- token/action restrictions
- protocol/selector restrictions
- spend tracking
- expiry
- emergency disable/revocation mechanism
- event emission

It must be designed specifically for EIP-7702 delegation.

Do not copy the current `BANVault.sol` architecture into this contract.

---

# 36. Testnet-first deployment sequence

## Phase A — EIP-7702 smoke test

Deploy a minimal delegation implementation.

Test:

```text
EOA
 ↓
sign EIP-7702 authorization
 ↓
relayer submits authorization transaction
 ↓
EOA receives delegation
 ↓
call delegated function
```

Confirm the transaction executes on BSC testnet.

---

## Phase B — identity test

From the delegated account:

```text
call protocol
```

Verify the protocol sees the expected user account/address.

This is a mandatory test before integrating any financial agent.

---

## Phase C — permission test

Create:

```text
maxTotal = 1,000 USDT
maxPerTx = 250 USDT
```

Test:

```text
200 → PASS
250 → PASS
251 → FAIL
800 cumulative → PASS
201 after 800 → FAIL
```

---

## Phase D — protocol selector test

Allow:

```text
Venus repay
```

Attempt:

```text
Venus repay → PASS
Venus arbitrary function → FAIL
PancakeSwap → FAIL
```

---

## Phase E — concurrency test

Start two executions simultaneously:

```text
Execution A = 700
Execution B = 500
```

Authorized total:

```text
1,000
```

Only one combination within the reserved total may succeed.

The SpendLedger must prevent:

```text
700 RESERVED
500 RESERVED
```

from both being accepted.

---

# 37. Migration from current Altana execution

Current verified runtime uses:

```text
agent-specific Altana signer
```

for direct protocol execution.

Do NOT delete this immediately.

Introduce execution modes:

```text
ExecutionMode =
  AGENT_WALLET
  USER_EIP7702
```

During migration:

```text
existing agents
    ↓
AGENT_WALLET

new user-wallet jobs
    ↓
USER_EIP7702
```

Once EIP-7702 is proven:

```text
USER_EIP7702
```

becomes the preferred mode for user-owned positions.

---

# 38. What happens to BAN Vault?

Keep `BANVault.sol` as an optional custody/escrow primitive.

It remains useful when the product explicitly wants:

```text
User
 ↓
deposit capital
 ↓
BAN job escrow
 ↓
agent operates escrow
```

But it should not be used for:

```text
User's existing Venus position
User's wallet-held USDT
User's wallet-owned LP position
```

when user identity must remain the protocol account.

---

# 39. M15 → M16 transition

The current M15 system already has:

```text
Agent
Session
Proposal
Policy
Execution
Performance
Activity
Registry
Inngest
```

Add:

```text
M16 — EIP-7702 User-Wallet Execution
```

### M16 closed loop

```text
USER CONNECTS WALLET
       ↓
CREATE JOB
       ↓
GENERATE PERMISSION CONFIG
       ↓
DISPLAY EXACT LIMITS
       ↓
ONE EIP-7702 AUTHORIZATION
       ↓
RELAY ACTIVATION
       ↓
VERIFY DELEGATION
       ↓
ACTIVATE SESSION
       ↓
AGENT OBSERVES
       ↓
AI DECIDES
       ↓
ACTION PROPOSAL
       ↓
POLICY ENGINE
       ↓
EIP-7702 PERMISSION CHECK
       ↓
SPEND RESERVATION
       ↓
PREFLIGHT
       ↓
RELAYER EXECUTES
       ↓
USER EOA / DELEGATED ACCOUNT
       ↓
PROTOCOL
       ↓
RECEIPT
       ↓
VERIFY
       ↓
COMMIT SPEND
       ↓
POSITION/PERFORMANCE/AUDIT
```

This is the closed loop the coding agent must prove.

---

# 40. Acceptance criteria

M16 is NOT complete until all are true:

### User experience

- [ ] User connects wallet.
- [ ] User creates a job.
- [ ] User sees exact permission boundaries.
- [ ] User performs one wallet authorization.
- [ ] BAN relays activation.
- [ ] No wallet popup occurs for subsequent autonomous execution.

### Identity

- [ ] User's EOA remains the account identity.
- [ ] No shared BAN Vault is used for this mode.
- [ ] Protocol interaction is attributable to the user's account.

### Security

- [ ] Agent cannot exceed max transaction amount.
- [ ] Agent cannot exceed cumulative allowance.
- [ ] Agent cannot use unauthorized token.
- [ ] Agent cannot use unauthorized protocol.
- [ ] Agent cannot use unauthorized function selector.
- [ ] Expired permission fails.
- [ ] Revoked permission fails.
- [ ] Unknown registry entry fails.
- [ ] Unknown calldata fails.
- [ ] Concurrent reservations cannot exceed allowance.

### Runtime

- [ ] AI never signs.
- [ ] AI never gets private keys.
- [ ] AI never chooses arbitrary target addresses.
- [ ] Policy Engine remains deterministic.
- [ ] Execution Engine remains deterministic.
- [ ] Inngest remains the durable job scheduler.
- [ ] Firestore remains control-plane state.
- [ ] On-chain permission is the final execution boundary.

---

# 41. Important unresolved engineering item

The architecture is verified at the **protocol/tooling level**, but the exact BAN permission construction is still an implementation decision.

In particular, the team must prove how the requested job limits are cryptographically bound to the **single EIP-7702 authorization** without adding a second user signature.

The recommended direction is:

```text
permission configuration
        ↓
deterministic permission implementation
        ↓
EIP-7702 authorization targets that implementation
```

This must be tested on BSC testnet before calling the one-signature UX production-ready.

Do NOT solve this by trusting an off-chain backend to impose limits after the EOA has delegated to a broadly privileged implementation.

That would weaken the security model.

---

# 42. Final BAN model

The final mental model is:

```text
                    USER
                     │
             owns funds directly
                     │
                     ▼
                USER EOA
                     │
             ONE AUTHORIZATION
                     │
                     ▼
          BAN EIP-7702 PERMISSION
                     │
        ┌────────────┼────────────┐
        │            │            │
       Agent        Job        Limits
        │            │            │
        └────────────┼────────────┘
                     ▼
              BAN POLICY ENGINE
                     │
               Spend Ledger
                     │
                     ▼
              EXECUTION ENGINE
                     │
                  RELAYER
                     │
                     ▼
                 USER EOA
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
        Venus    PancakeSwap   Other
```

**One user authorization.**

**User funds remain in the user's wallet.**

**No shared BAN Vault identity for user-owned positions.**

**AI remains the brain, never the authority.**

**BAN Policy remains the guard.**

**The user's address remains the protocol-facing account.**

---

## Sources verified

- BNB Chain Pascal hardfork / BEP-441 EIP-7702 implementation:
  https://docs.bnbchain.org/announce/pascal-bsc/
- Ethereum EIP-7702 specification:
  https://eips.ethereum.org/EIPS/eip-7702
- Viem EIP-7702 overview:
  https://viem.sh/docs/eip7702
- Viem `signAuthorization`:
  https://viem.sh/docs/eip7702/signAuthorization
- Viem EIP-7702 transaction sending:
  https://viem.sh/docs/eip7702/sending-transactions
