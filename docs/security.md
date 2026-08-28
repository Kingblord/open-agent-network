# BAN Security Model

## Non-negotiable chain

```
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

## Invariants

- `No permission = no transaction`
- `AI failure = no transaction`
- `Queue retry != duplicate financial action`
- Every financial job carries a deterministic idempotency key.
- A retry must **reconcile state**, never blindly resubmit.
- Secrets live in Vercel/Secret Manager — **never Firestore**.

## Failure handling

Classify the error, reconcile chain state, then decide retryability —
**never** from an LLM response.

| Failure | Action |
|---|---|
| RPC timeout after submission | Reconcile transaction first; never resubmit blindly |
| Preflight failure | Do not execute |
| Permission failure | Permanent rejection |
| Temporary provider failure | Safe retry |

## Observability

Every autonomous action must be traceable via:

```
correlationId
agentId
proposalId
jobId
executionId
transactionHash
```