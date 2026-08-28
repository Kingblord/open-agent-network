/**
 * @ban/registry — BAN contract/token/protocol/ABI registries (mustflow §10–14).
 *
 * Registry package = the internal source of truth for what BAN may touch.
 * Every registry is fail-closed: unknown addresses, tokens, protocols,
 * deployments, and ABI fragments are DENIED unless explicitly registered,
 * verified, and enabled for the BAN execution chain (mainnet 56 by default).
 */
export * from './address-verifier.js';
export * from './token-registry.js';
export * from './protocol-registry.js';
export * from './deployment-registry.js';
export * from './contract-registry.js';
export * from './abi-registry.js';
//# sourceMappingURL=index.d.ts.map