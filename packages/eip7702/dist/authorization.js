import { encodePacked, keccak256, toHex, concat } from 'viem';
import { BANError, ErrorCode } from '@ban/shared';
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
export const BAN_MAINNET_CHAIN_ID = 56;
/** The EIP-7702 authorization type string (same across viem versions). */
export const EIP7702_AUTHORIZATION_TYPE = 'EIP7702Authorization';
// ---------------------------------------------------------------------------
// Authorization tuple helpers
// ---------------------------------------------------------------------------
/** Convert a typed authorization object to the raw tuple form. */
export function toAuthorizationTuple(auth) {
    return [auth.chainId, auth.address, auth.nonce, auth.yParity, auth.r, auth.s];
}
/** Parse a raw tuple back to the typed object. */
export function fromAuthorizationTuple(tuple) {
    const [chainId, address, nonce, yParity, r, s] = tuple;
    return { chainId, address, nonce, yParity, r, s };
}
// ---------------------------------------------------------------------------
// Typed-digest (EIP-7702 domain) construction
// ---------------------------------------------------------------------------
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
export function eip7702Digest(auth) {
    const { chainId, address, nonce } = auth;
    const packed = encodePacked(['uint256', 'address', 'uint256'], [BigInt(chainId), address, BigInt(nonce)]);
    return keccak256(packed);
}
// ---------------------------------------------------------------------------
// Authority binding (user ‖ agent ‖ configHash)
// ---------------------------------------------------------------------------
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
export function computeAuthority(input) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.userAddress)) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Invalid user EOA address: ${input.userAddress}`);
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(input.configHash)) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Invalid configHash: ${input.configHash}`);
    }
    const packed = encodePacked(['address', 'bytes', 'bytes32'], [
        input.userAddress,
        toHex(input.agentId),
        input.configHash,
    ]);
    return keccak256(packed);
}
/**
 * Build the on-chain `DelegationState` record for a permission + config hash.
 * Pure; does not verify a signature (verification.ts does that).
 */
export function buildDelegationState(input) {
    return {
        userAddress: input.userAddress,
        agentId: input.agentId,
        delegateAddress: input.delegateAddress,
        configHash: input.configHash,
        authority: computeAuthority({
            userAddress: input.userAddress,
            agentId: input.agentId,
            configHash: input.configHash,
        }),
        nonce: input.nonce,
        status: 'PENDING',
        validAfter: input.validAfter,
        validUntil: input.validUntil,
        createdAt: new Date().toISOString(),
    };
}
/**
 * Convert a complete AgentPermission into a deterministic `DelegationState`.
 * Fails closed if the permission is missing a field `DelegationState` requires
 * (userAddress, validity window).
 */
export function delegationStateFromPermission(perm, delegateAddress) {
    if (!perm.userAddress || !perm.validAfter || !perm.validUntil) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Permission ${perm.id} is missing userAddress or validity window required for a DelegationState`);
    }
    return buildDelegationState({
        userAddress: perm.userAddress,
        agentId: perm.agentId,
        delegateAddress,
        configHash: perm.onchainRegistryReference ?? '',
        nonce: perm.nonce,
        validAfter: perm.validAfter,
        validUntil: perm.validUntil,
    });
}
// Re-export for API/UI convenience.
export { concat as concatHex };
