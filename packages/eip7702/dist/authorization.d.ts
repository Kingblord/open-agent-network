import { concat } from 'viem';
import type { Eip7702Authorization, Eip7702AuthorizationTuple, AgentPermission, DelegationState } from '@ban/schemas';
/**
 * EIP-7702 core primitives: authorization tuples, typed digests, and
 * deterministic authority binding.
 *
 * This module is a pure, hermetic EIP-7702 implementation (viem primitives
 * only — no RPC, no network, no Firebase). It produces and verifies the
 * authorization tuple (`[chain_id, address, nonce, y_parity, r, s]`) and the
 * typed digest the user signs, plus the `authority` that bind user + agent +
 * permission-config so a delegated implementation cannot drift off the
 * signed limits.
 */
export declare const BAN_MAINNET_CHAIN_ID = 56;
/** The EIP-7702 authorization type string (same across viem versions). */
export declare const EIP7702_AUTHORIZATION_TYPE = "EIP7702Authorization";
/** Convert a typed authorization object to the raw tuple form. */
export declare function toAuthorizationTuple(auth: Eip7702Authorization): Eip7702AuthorizationTuple;
/** Parse a raw tuple back to the typed object. */
export declare function fromAuthorizationTuple(tuple: Eip7702AuthorizationTuple): Eip7702Authorization;
/**
 * Compute the EIP-7702 authorization digest the USER signs, per EIP-7702 / viem.
 *
 * The digest binds the user EOA, the delegated code (`address`), the chain id,
 * and the account nonce — so a replayed/repurposed signature is impossible.
 *
 * EIP-7702 defines the authorization structure as:
 *   auth = [chain_id, address, nonce, y_parity, r, s]
 * The user signs `keccak(chain_id ‖ address ‖ nonce)` and the remaining
 * (y_parity, r, s) are appended by the signer. We reproduce that preimage
 * exactly with viem's encodePacked over the first 3 fields.
 */
export declare function eip7702Digest(auth: Eip7702Authorization): string;
/**
 * Deterministic authority for a delegated agent:
 *
 *     authority = keccak256(userAddress ‖ agentId ‖ configHash)
 *
 * The delegated implementation (e.g. BANPermissionAccount) uses this to prove
 * the EOA delegated to the exact agent + permission profile. ConfigHash is a
 * keccak over the serialized, canonical permission config (see
 * permission-binding.ts) — so the user's single signature fixes the entire
 * limits/allowlist/expiry set on-chain.
 */
export declare function computeAuthority(input: {
    userAddress: string;
    agentId: string;
    configHash: string;
}): string;
/**
 * Build the on-chain `DelegationState` record for a permission + config hash.
 * Pure; does not verify a signature (verification.ts does that).
 */
export declare function buildDelegationState(input: {
    userAddress: string;
    agentId: string;
    delegateAddress: string;
    configHash: string;
    nonce: string;
    validAfter: string;
    validUntil: string;
}): DelegationState;
/**
 * Convert a complete AgentPermission into a deterministic `DelegationState`.
 * Fails closed if the permission is missing a field `DelegationState` requires
 * (userAddress, validity window).
 */
export declare function delegationStateFromPermission(perm: AgentPermission, delegateAddress: string): DelegationState;
export { concat as concatHex };
//# sourceMappingURL=authorization.d.ts.map