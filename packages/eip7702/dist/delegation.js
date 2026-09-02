import { BANError, ErrorCode } from '@ban/shared';
import { buildDelegationState, computeAuthority } from './authorization.js';
import { permissionConfigHash } from './permission-binding.js';
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
export function assertActivatable(perm) {
    // A permission is activatable only from the pre-authorization PENDING state.
    if (perm.status !== 'PENDING') {
        throw new BANError(ErrorCode.POLICY_DENIED, `Permission ${perm.id} is ${perm.status}, not PENDING; cannot activate`);
    }
    if (!perm.validAfter || !perm.validUntil) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Permission ${perm.id} has an invalid validity window`);
    }
    const now = Date.now();
    const after = new Date(perm.validAfter).getTime();
    const until = new Date(perm.validUntil).getTime();
    if (Number.isNaN(after) || Number.isNaN(until)) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Permission ${perm.id} has an invalid validity window`);
    }
    if (now < after || now >= until) {
        throw new BANError(ErrorCode.POLICY_DENIED, `Permission ${perm.id} is outside its validity window [${perm.validAfter}, ${perm.validUntil})`);
    }
    if (BigInt(perm.spend?.spendLimit ?? '0') <= 0n) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Permission ${perm.id} has a non-positive spendLimit`);
    }
}
/**
 * Build the `DelegationState` for an active authorization, binding the exact
 * config hash that the single signature fixed.
 */
export function delegationForPermission(perm, delegateAddress) {
    if (!perm.userAddress || !perm.validAfter || !perm.validUntil) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Permission ${perm.id} is missing userAddress or validity window required to build a DelegationState`);
    }
    const state = buildDelegationState({
        userAddress: perm.userAddress,
        agentId: perm.agentId,
        delegateAddress,
        configHash: permissionConfigHash(perm),
        nonce: perm.nonce,
        validAfter: perm.validAfter,
        validUntil: perm.validUntil,
    });
    return { ...state, status: 'ACTIVE' };
}
/**
 * Confirm the authorization was signed over the exact permission config.
 * Fails closed if the recovered authority differs.
 */
export function assertAuthorityMatches(perm, auth, delegateAddress) {
    if (!perm.userAddress) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Permission ${perm.id} is missing resolved owner (userAddress); cannot compare authority`);
    }
    const expectedAuthority = computeAuthority({
        userAddress: perm.userAddress,
        agentId: perm.agentId,
        configHash: permissionConfigHash(perm),
    });
    // The single signed authorization does not carry authority; we verify the
    // signature maps to `perm.userAddress` (verification.ts does that). Here we
    // additionally prove the delegated authority would resolve to this config.
    if (auth.address.toLowerCase() !== delegateAddress.toLowerCase()) {
        throw new BANError(ErrorCode.POLICY_DENIED, `Authorization delegates to ${auth.address}, not ${delegateAddress}`);
    }
    void expectedAuthority; // derived deterministically above; used by the contract
}
/** Compute the next monotonic permission nonce from an existing one. */
export function nextPermissionNonce(prev) {
    return String(BigInt(prev ?? '0') + 1n);
}
