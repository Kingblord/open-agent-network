/**
 * M4 - Altana session adapter seam (Rule 8).
 *
 * BAN talks to the Altana wallet/session stack ONLY through this interface.
 * The SessionManager (lib/session-manager.ts) is SDK-agnostic: it takes an
 * `AltanaAdapter` in its constructor and never depends on the `@altananetwork/sdk`
 * or viem at rest-runtime / test time. That keeps the durable BAN logic
 * (state machine, limits, deny-checks, persistence) provable outside any
 * browser/passkey runtime, while real on-chain calls live behind the adapter.
 *
 * Providers:
 *   - altana (apps/web/lib/altana/real-provider.ts)  - real SDK
 *   - dev (apps/web/lib/altana/dev-provider.ts)       - deterministic fake for
 *     tests / local development when ALTANA_PROVIDER=dev
 *
 * These types intentionally mirror the SDK's concepts (calls / spend limits /
 * expiry / wallet) but are defined here in SDK-free terms so nothing higher in
 * the stack leaks `viem` types.
 */

/** A single scoped action the session may (or may not) authorize. */
export interface SessionCallRequest {
  /** Target contract/`to` address. */
  to: string;
  /** Function selector/signature being called (e.g. "deposit(uint256)"). */
  function?: string;
  /** Token address being spent ("0x0000...0000" / zero-address = native). */
  token: string;
  /** Value being moved, in wei (decimal string). */
  amountWei?: string;
}

/** Everything required to grant a scoped session for a wallet. */
export interface AltanaGrant {
  agentId: string;
  /** Wallet the session is scoped to (must belong to the agent). */
  walletAddress: string;
  /** Allowed contracts (empty = only native unless constrained elsewhere). */
  allowedContracts: string[];
  /** Allowed function selectors. */
  allowedFunctions: string[];
  /** Allowed token addresses. */
  allowedTokens: string[];
  /** Rolling spend cap, wei (decimal string). */
  spendCap: string;
  /** Per-transaction cap, wei (decimal string). Must be <= spendCap. */
  perTransactionCap: string;
  /** Session expiry as Unix epoch seconds. */
  expiresAtUnixSec: number;
}

export interface AltanaGrantResult {
  /** Identifies the session key / public key registered on-chain. */
  sessionKeyReference: string;
  /** On-chain registry reference (tx hash / id), when registered on-chain. */
  onchainRegistryReference: string | null;
  /** Unix epoch seconds the issued session is valid to. */
  expiry: number;
}

export interface AltanaRevoke {
  walletAddress: string;
  /** The session key reference previously granted. */
  sessionKeyReference: string;
}

export interface AltanaRevokeResult {
  revoked: boolean;
  /** Registry reference reflecting the revoked state, when available. */
  onchainRegistryReference: string | null;
}

/** Wallet creation / provisioning surface. */
export interface AltanaWalletResult {
  address: string;
}

export interface AltanaAdapter {
  provider: 'altana' | 'dev';
  /** Provision a wallet if none exists; idempotent if already provisioned. */
  ensureWallet(): Promise<AltanaWalletResult>;
  /** Issue a scoped, time-bounded session for an existing wallet. */
  grantSession(input: AltanaGrant): Promise<AltanaGrantResult>;
  /** Revoke a previously granted session. */
  revokeSession(input: AltanaRevoke): Promise<AltanaRevokeResult>;
}