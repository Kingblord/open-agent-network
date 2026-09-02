import type { AgentPermission } from '@ban/schemas';
/**
 * Compute the canonical permission config hash from an AgentPermission.
 * Pure and deterministic; throws (fail-closed) on a missing required field.
 *
 * `spendLimit` is the CANONICAL cumulative ceiling on the schema (the
 * required field). `spendCap` is a legacy alias only; producers should write
 * `spendLimit` and this hash reads `spendLimit`.
 */
export declare function permissionConfigHash(perm: AgentPermission): string;
/**
 * Build a fresh permission with `onchainRegistryReference` set to its
 * canonical config hash. Off-chain producer convenience.
 */
export declare function withConfigHash(perm: AgentPermission): AgentPermission;
//# sourceMappingURL=permission-binding.d.ts.map