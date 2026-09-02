import { type Address } from 'viem';
import type { Eip7702Authorization, AgentPermission } from '@ban/schemas';
/**
 * EIP-7702 signature verification + signer recovery (hermetic, pure).
 *
 * Reuses viem's `recoverAddress` over the canonical digest so the ONE signed
 * authorization can be proven to come from the user EOA and the delegated
 * authority is exactly user ‖ agent ‖ configHash.
 *
 * All checks are offline and deterministic — no RPC, no network. This module
 * exists so the backend derives authority from the VERIFIED payload rather
 * than trusting anything the frontend sends.
 */
/** Recover the signer EOA for a signed authorization (raw-digest form). */
export declare function recoverAuthorizationSigner(auth: Eip7702Authorization, signature: string): Promise<Address>;
/**
 * Verify a signed authorization against an expected user EOA.
 *
 * Accepts BOTH signature encodings deterministically:
 *   - the RAW 32-byte digest signature (hermetic tests / dev tooling), and
 *   - the EIP-191 personal_sign wrapper (keccak("\x19Ethereum Signed Message:\n32" ‖ digest))
 *     which thirdweb/viem wallets produce for `account.sign({ message })`.
 *
 * Recovery is dual-path on purpose: for a valid 65-byte signature both forms
 * yield a deterministic address, so we check whether EITHER recovered signer
 * matches the expected user EOA. This keeps the raw-digest test vectors green
 * while allowing the real wallet-sign UX to verify server-side.
 */
export declare function verifyAuthorizationSigner(auth: Eip7702Authorization, signature: string, expectedUser: string): Promise<boolean>;
/**
 * Verify the full authorization is valid for a given permission profile:
 *   - signer must match the permission's user EOA,
 *   - chain id must match the permission's domain chain,
 *   - nonce must match the permission's replay guard.
 * Fails closed (throws) on any mismatch or a missing permission owner.
 */
export declare function verifyAuthorizationForPermission(input: {
    auth: Eip7702Authorization;
    signature: string;
    permission: AgentPermission;
    chainId?: number;
}): Promise<boolean>;
//# sourceMappingURL=verification.d.ts.map