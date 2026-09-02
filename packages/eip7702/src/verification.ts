import { recoverAddress, hashMessage, type Address } from 'viem';
import { BANError, ErrorCode } from '@ban/shared';
import type { Eip7702Authorization, AgentPermission } from '@ban/schemas';
import { eip7702Digest } from './authorization.js';

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
export async function recoverAuthorizationSigner(
  auth: Eip7702Authorization,
  signature: string,
): Promise<Address> {
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new BANError(ErrorCode.VALIDATION_FAILED, `Invalid 65-byte EIP-712-style signature: ${signature}`);
  }
  const digest = eip7702Digest(auth);
  try {
    return await recoverAddress({
      hash: digest as `0x${string}`,
      signature: signature as `0x${string}`,
    });
  } catch (err) {
    throw new BANError(
      ErrorCode.SCHEMA_INVALID,
      `Could not recover the authorization signer from the provided signature: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    );
  }
}

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
export async function verifyAuthorizationSigner(
  auth: Eip7702Authorization,
  signature: string,
  expectedUser: string,
): Promise<boolean> {
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new BANError(ErrorCode.VALIDATION_FAILED, `Invalid 65-byte EIP-712-style signature: ${signature}`);
  }
  const digest = eip7702Digest(auth) as `0x${string}`;
  try {
    const [rawSigner, prefixedSigner] = await Promise.all([
      recoverAddress({ hash: digest, signature: signature as `0x${string}` }),
      recoverAddress({ hash: hashMessage(digest), signature: signature as `0x${string}` }),
    ]);
    const expected = expectedUser.toLowerCase();
    return (
      rawSigner.toLowerCase() === expected ||
      prefixedSigner.toLowerCase() === expected
    );
  } catch (err) {
    throw new BANError(
      ErrorCode.SCHEMA_INVALID,
      `Could not recover the authorization signer from the provided signature: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    );
  }
}

/**
 * Verify the full authorization is valid for a given permission profile:
 *   - signer must match the permission's user EOA,
 *   - chain id must match the permission's domain chain,
 *   - nonce must match the permission's replay guard.
 * Fails closed (throws) on any mismatch or a missing permission owner.
 */
export async function verifyAuthorizationForPermission(input: {
  auth: Eip7702Authorization;
  signature: string;
  permission: AgentPermission;
  chainId?: number;
}): Promise<boolean> {
  const expectedChain = input.chainId ?? 56;
  if (BigInt(input.auth.chainId) !== BigInt(expectedChain)) {
    throw new BANError(
      ErrorCode.POLICY_DENIED,
      `Authorization chain ${input.auth.chainId} does not match expected ${expectedChain}`,
    );
  }
  if (!input.permission.userAddress) {
    throw new BANError(
      ErrorCode.POLICY_DENIED,
      `Permission ${input.permission.id} has no resolved owner (userAddress); cannot verify authorization`,
    );
  }
  if (!(await verifyAuthorizationSigner(input.auth, input.signature, input.permission.userAddress))) {
    throw new BANError(ErrorCode.POLICY_DENIED, 'Authorization signer does not match the permission owner');
  }
  // The nonce from the signed authorization must equal the permission's
  // monotonic guard (replay prevention).
  const permissionNonce = BigInt(input.permission.nonce || '0');
  if (BigInt(input.auth.nonce) !== permissionNonce) {
    throw new BANError(
      ErrorCode.POLICY_DENIED,
      `Authorization nonce ${input.auth.nonce} does not match permission nonce ${input.permission.nonce}`,
    );
  }
  return true;
}