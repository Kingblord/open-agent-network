import { z } from 'zod';

/**
 * EIP-7702 — Set EOA account code (authorization) schemas.
 *
 * Mirrors the BAN EIP-7702 spec (one-signature autonomous agents):
 *   - A user EOA authorizes a BAN agent to act on their behalf by
 *     delegating (EIP-7702) to BAN permission code, bound to a strict
 *     on-chain permission profile (limits, allowlists, expiry).
 *   - The authorization tuple is a single typed object:
 *     [chain_id, address, nonce, y_parity, r, s].
 *   - `authority` deterministically binds user + agent + config:
 *       authority = keccak256(user ‖ agent ‖ configHash)
 *     so a delegated implementation (e.g. BANPermissionAccount) can enforce
 *     the exact job/budget/allowlist signed by the user — never trust
 *     off-chain permission after delegation.
 *
 * These schemas are runtime-agnostic (zod only — no viem, no Next, no
 * Firebase) so package consumers (API routes, execution engine, UI) share one
 * vocabulary.
 */

// ---------------------------------------------------------------------------
// EIP-7702 authorization tuple (raw EIP-7702 type: [chain_id, address, nonce, y_parity, r, s])
// ---------------------------------------------------------------------------

export const Eip7702AuthorizationSchema = z.object({
  /** Chain id the authorization is valid on (BAN mainnet 56). */
  chainId: z.number().int().positive(),
  /** Address of the implementation contract the EOA delegates to. */
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Account nonce of the user EOA at authorization time. */
  nonce: z.bigint(),
  /** Signature parity (0 | 1). */
  yParity: z.union([z.literal(0), z.literal(1)]),
  /** Signature r (32 bytes). */
  r: z.bigint(),
  /** Signature s (32 bytes). */
  s: z.bigint(),
});
export type Eip7702Authorization = z.infer<typeof Eip7702AuthorizationSchema>;

/** Raw tuple form (viem's Authorization type) — [chainId, address, nonce, yParity, r, s]. */
export const Eip7702AuthorizationTupleSchema = z.tuple([
  z.bigint(),
  z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  z.bigint(),
  z.union([z.literal(0), z.literal(1)]),
  z.bigint(),
  z.bigint(),
]);
export type Eip7702AuthorizationTuple = z.infer<typeof Eip7702AuthorizationTupleSchema>;

// ---------------------------------------------------------------------------
// Agent permission profile (the config the single auth is cryptographically
// bound to — on-chain limits + allowlists). This is a schema-level mirror of
// the contract's stored/permitted configuration for typed-data hashing and
// off-chain policy pre-checks.
// ---------------------------------------------------------------------------

export const PermissionSpendSchema = z.object({
  /** Cumulative ceiling (wei decimal string). */
  spendCap: z.string(),
  /** Per-transaction ceiling (wei decimal string). */
  perTransactionCap: z.string(),
});
export type PermissionSpend = z.infer<typeof PermissionSpendSchema>;

export const AgentPermissionSchema = z.object({
  /** Unique permission id (e.g. `perm_<uuid>`). */
  id: z.string(),
  /** Agent the permission authorizes. */
  agentId: z.string(),
  /** User EOA (delegating account) that authorized this. */
  userId: z.string(),
  /** EOA address the user controls (must match the signed EIP-7702 authority). */
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Job/task this permission is scoped to (the vault's jobId == taskId). */
  jobId: z.string().optional(),
  /** Canonical capabilities granted (e.g. 'PROPOSE_SWAP'). */
  capabilities: z.array(z.string()).default([]),
  /** Allowed protocol ids (registry-resolved). */
  allowedProtocols: z.array(z.string()).default([]),
  /** Allowed contract addresses (fail-closed allowlist). */
  allowedContracts: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)).default([]),
  /** Allowed function selectors (4-byte hex or signature). */
  allowedFunctions: z.array(z.string()).default([]),
  /** Allowed token addresses/symbols. */
  allowedTokens: z.array(z.string()).default([]),
  /** Spend ceilings mirrored on-chain (auth config hash). */
  spend: PermissionSpendSchema,
  /** ISO-8601 validity window. */
  validAfter: z.string(),
  validUntil: z.string(),
  /** Monotonic nonce to prevent replay across revocations. */
  nonce: z.string(),
  /** On-chain registry reference (placeholder for the delegated account). */
  onchainRegistryReference: z.string().nullable().default(null),
  status: z.enum(['PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED']).default('PENDING'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;

// ---------------------------------------------------------------------------
// Delegation authorization (the EIP-712-ish typed message the USER signs once —
// not an execution approval, not an ERC-20 allowance).
// ---------------------------------------------------------------------------

export const DelegationAuthorizationSchema = z.object({
  /** User's EOA address. */
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Agent contract/identity being authorized. */
  agentId: z.string(),
  /** The BAN permission account (delegate) implementation address. */
  delegateAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Job/task this delegation is scoped to. */
  jobId: z.string().optional(),
  /** The exact permission profile it binds to. */
  permission: AgentPermissionSchema.partial(),
  /** Validity window (ISO-8601). */
  validAfter: z.string(),
  validUntil: z.string(),
  /** Replay-prevention nonce (monotonic). */
  nonce: z.string(),
  /** EIP-712 domain fields. */
  domain: z.object({
    name: z.string().default('BAN Smart Money'),
    version: z.string().default('1'),
    chainId: z.number().int().positive().default(56),
    verifyingContract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
  /** The user's EIP-712 typed-data signature (65-byte hex). */
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});
export type DelegationAuthorization = z.infer<typeof DelegationAuthorizationSchema>;

// ---------------------------------------------------------------------------
// Combined on-chain state record (what policy/execution reads)
// ---------------------------------------------------------------------------

export const DelegationStateSchema = z.object({
  /** user EOA */
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** agent the delegation authorizes */
  agentId: z.string(),
  /** delegated code address */
  delegateAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** canonical permission profile hash (keccak of serialized config) */
  configHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  /** deterministic authority = keccak(user ‖ agent ‖ configHash) */
  authority: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  /** wallet nonce consumed */
  nonce: z.string(),
  status: z.enum(['PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED']).default('PENDING'),
  /** ISO-8601 */
  validAfter: z.string(),
  validUntil: z.string(),
  createdAt: z.string(),
});
export type DelegationState = z.infer<typeof DelegationStateSchema>;