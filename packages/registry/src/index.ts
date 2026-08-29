/**
 * @ban/registry — BAN contract/token/protocol/ABI registries (mustflow §10–14).
 *
 * Registry package = the internal source of truth for what BAN may touch.
 * Every registry is fail-closed: unknown addresses, tokens, protocols,
 * deployments, and ABI fragments are DENIED unless explicitly registered,
 * verified, and enabled for the BAN execution chain (mainnet 56 by default).
 *
 * The default BSC set is intentionally SMALL and verified-first (hackathon
 * scope): PancakeSwap + Venus (P0) are the first EXECUTION-ENABLED
 * integrations (deliberate activation 2026-08-28 — see bnb-contracts.ts and
 * bnb-mainnet.ts; this is the explicit ops step, never auto-seeded). Aave V3
 * / Lista DAO / THENA / Wombat / Aspan are selectable candidates awaiting
 * pipeline verification + deliberate activation; Stargate is DISCOVERY_ONLY.
 *
 * Activation safety: `verified ≠ enabled` (mustflow §12) is preserved as the
 * general rule. Only the P0 set has been deliberately opened for autonomous
 * execution; every other protocol/contract remains fail-closed DENIED.
 *
 * IMPORTANT (no import side effects): this package must be safe to import at
 * RUNTIME without triggering network calls. The seed-verification pipeline
 * (verify-seeds.ts) is an ops CLI that performs live `eth_getCode` checks; it
 * is deliberately NOT re-exported here and runs only when executed directly
 * (`node dist/seed-catalog/verify-seeds.js` via the `verify:seeds` script).
 * Importing @ban/registry never performs any network I/O.
 */

export * from './address-verifier.js';
export * from './token-registry.js';
export * from './protocol-registry.js';
export * from './deployment-registry.js';
export * from './contract-registry.js';
export * from './abi-registry.js';
export * from './bnb-mainnet.js';
export * from './bnb-contracts.js';
export * from './snapshot.js';
export * from './seed-catalog/bnb-seeds.js';