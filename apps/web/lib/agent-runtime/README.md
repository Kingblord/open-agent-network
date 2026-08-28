# BAN Agent Runtime (Batch C — closed loop)

This directory holds the orchestration that drives a deployed agent through the
BAN closed loop and writes the observable result back into the control plane so
the dashboard / activity / performance pages show REAL data.

```
OBSERVE → REASON → PROPOSE → POLICY → EXECUTE → VERIFY → POSITION → AUDIT → UI
```

## Honesty contract

BAN never fabricates a chain. Each stage is additive and only writes an event
when the underlying step actually produced it:

- Observation persists an `OBSERVATION` event from a real strategy adapter.
- Decision persists an `AI_DECISION` event (OpenRouter when configured, else a
  deterministic dev brain). A decision to act is only persisted as ACT after
  policy validation.
- A proposal that passes policy is reserved; a denied proposal is recorded as
  a DENY event. No reserved spend without a real reservation.
- Execution only records `TRANSACTION_CONFIRMED` when an actual signing/onchain
  backend confirmed a transaction. Without a signer/RPC the loop stops at an
  honest `AWAITING_EXECUTION` state — it NEVER emits a fabricated confirmed tx.
- Position/performance are only written from a confirmed execution.

This keeps the Activity/Performance pages truthful at every stage of the loop.