import type { AgentPermission, DelegationState, Eip7702Authorization } from '@ban/schemas';
/**
 * EIP-7702 delegation lifecycle: activation, nonce/replay guards, expiry, and
 * (planned) revocation accounting. Pure + offline — no RPC, no persistence.
 *
 * The single authorization must determine the FULL permission profile via
 * `configHash`. These helpers ensure a permission cannot be activated with an
 * empty/mismatched config and that replay/expiry are enforced before any
 * executor is reached.
 */
/** Validate a permission is currently activatable (ENFORCED, fail-closed). */
export declare function assertActivatable(perm: AgentPermission): void;
/**
 * Build the `DelegationState` for an active authorization, binding the exact
 * config hash that the single signature fixed.
 */
export declare function delegationForPermission(perm: AgentPermission, delegateAddress: string): DelegationState;
/**
 * Confirm the authorization was signed over the exact permission config.
 * Fails closed if the recovered authority differs.
 */
export declare function assertAuthorityMatches(perm: AgentPermission, auth: Eip7702Authorization, delegateAddress: string): void;
/** Compute the next monotonic permission nonce from an existing one. */
export declare function nextPermissionNonce(prev: string | undefined): string;
//# sourceMappingURL=delegation.d.ts.map