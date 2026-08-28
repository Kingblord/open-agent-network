# BAN Architecture

BAN is a reusable autonomous-agent execution network (BAN Core) with a first
consumer vertical: **BAN Smart Money**, a BNB Chain marketplace where users
discover, hire, authorize, monitor and revoke autonomous financial agents.

## Planes

### Control plane (durable state: Firestore)

Identity, agent registry, sessions, permission policies, strategy config, jobs,
audit events, marketplace metadata.

### Runtime plane

Observations, tools, AI reasoning, strategy calculations, candidate actions,
policy evaluation, execution, verification, position reconciliation.

### Data plane

BNB state (via viem + adapters), protocol adapters, price/yield/LP data,
transaction receipts, positions, performance.

## Trust boundary

The only component allowed to cross from BAN's logical runtime into blockchain
transaction authority is the **Execution Engine**, and only through a valid
scoped agent session.

```
AI != signer
AI != wallet
AI != policy
AI != executor
AI = reasoning engine
```

Never:

```
LLM -> private key -> transaction
```

Always:

```
LLM -> structured proposal -> deterministic policy engine -> executor
```

## Automation stack (approved)

| Role | Technology |
|---|---|
| Control-plane API | Next.js route handlers on Vercel |
| Durable jobs / schedules | Inngest (primary); QStash (fallback) |
| CI/CD | GitHub Actions (lint, test, build, deploy) |
| Durable state | Firestore |
| Blockchain | BNB Chain (testnet first) |

## Closed loop (Rule 1)

Every milestone's loop:

```
observe -> decide -> validate -> execute -> verify -> persist -> display
```

A feature is done only when the entire loop works — not when files exist.

See [milestone.md](./milestone.md) for the full build order.