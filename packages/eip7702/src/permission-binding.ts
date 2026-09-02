import { encodePacked, keccak256, toHex } from 'viem';
import { BANError, ErrorCode } from '@ban/shared';
import type { AgentPermission } from '@ban/schemas';

/**
 * Permission binding — cryptographically fix a job's exact limits to the
 * single EIP-7702 authorization.
 *
 * Because the user signs ONE authorization tuple, the delegated implementation
 * must deterministically derive every limit/allowlist from a canonical
 * `configHash` bound to that signature. This module computes that hash from a
 * normalized permission record so:
 *   - two identical permission configs always yield the same hash,
 *   - any change to a limit/allowlist/expiry yields a different hash,
 *   - the on-chain authority = keccak(user ‖ agent ‖ configHash) proves the
 *     EOA approved exactly this config.
 *
 * Normalization order is fixed (arrays sorted, addresses lowercased) so the
 * hash is stable across producers.
 */

/** Canonical hex string for a set of addresses (sorted, lowercased). */
function canonicalAddressList(addrs: string[]): string {
  const lower = addrs.map((a) => a.toLowerCase());
  lower.sort();
  return lower.join('|');
}

/** Canonical hex string for an opaque string list (sorted). */
function canonicalStringList(items: string[]): string {
  const sorted = [...items].map((s) => s.trim()).sort();
  return sorted.join('|');
}

/**
 * Compute the canonical permission config hash from an AgentPermission.
 * Pure and deterministic; throws (fail-closed) on a missing required field.
 *
 * `spendLimit` is the CANONICAL cumulative ceiling on the schema (the
 * required field). `spendCap` is a legacy alias only; producers should write
 * `spendLimit` and this hash reads `spendLimit`.
 */
export function permissionConfigHash(perm: AgentPermission): string {
  if (!perm.agentId) throw new BANError(ErrorCode.VALIDATION_FAILED, 'permission is missing agentId');
  if (!perm.userAddress) throw new BANError(ErrorCode.VALIDATION_FAILED, 'permission is missing userAddress');
  if (!perm.spend || !perm.spend.spendLimit || !perm.spend.perTransactionCap) {
    throw new BANError(ErrorCode.VALIDATION_FAILED, 'permission is missing spend limits (spendLimit, perTransactionCap)');
  }
  if (!perm.validAfter || !perm.validUntil) {
    throw new BANError(ErrorCode.VALIDATION_FAILED, 'permission is missing validity window');
  }

  const domainSep = 'BAN_PERMISSION_V1';
  const joined = [
    domainSep,
    perm.agentId,
    canonicalAddressList([perm.userAddress]),
    canonicalStringList(perm.capabilities),
    canonicalStringList(perm.allowedProtocols),
    canonicalAddressList(perm.allowedContracts),
    canonicalStringList(perm.allowedFunctions),
    canonicalStringList(perm.allowedTokens),
    perm.spend.spendLimit,
    perm.spend.perTransactionCap,
    perm.validAfter,
    perm.validUntil,
  ].join('|');

  // encodePacked needs BOTH the abi-types array and the values array.
  const packed = encodePacked(
    ['bytes', 'bytes'],
    [toHex(domainSep), toHex(joined)],
  );
  return keccak256(packed as `0x${string}`);
}

/**
 * Build a fresh permission with `onchainRegistryReference` set to its
 * canonical config hash. Off-chain producer convenience.
 */
export function withConfigHash(perm: AgentPermission): AgentPermission {
  // We must not mutate the caller's object.
  return {
    ...perm,
    onchainRegistryReference: permissionConfigHash(perm),
  };
}