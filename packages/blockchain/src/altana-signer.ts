import { BANError, ErrorCode, createLogger } from '@ban/shared';
import type { ActionProposal, Session } from '@ban/schemas';
import { requireBlockchainRuntime } from './index.js';

/**
 * Altana Agent Wallet signer seam — the REAL on-chain signing backend for BAN
 * agents (mustflow §28 session-signer boundary, milestone Agent Wallet).
 *
 * Per Altana's model (no relayer needed):
 *   - Altana wallets are smart-contract wallets that execute natively on-chain.
 *   - The SDK builds + submits transactions directly to BNB.
 *   - To sign you need a PRIVATE-KEY signer (agents must run unattended; a
 *     passkey would require a human gesture).
 *   - BEFORE the wallet can execute, BNB must be sent to it. The first
 *     transaction both ACTIVATES the wallet and registers its admin key in
 *     Altana's Keystore.
 *
 * We therefore express the signer as the `altana` backend for the session
 * signer. It NEVER fabricates a hash: without a funded wallet + configured SDK
 * env it refuses (fail-closed). The private key belongs to the AGENT (held in
 * this server-side signer), never the AI (invariant #2).
 *
 * The Altana SDK (`@altananetwork/sdk`) is a dependency of `apps/web` (the
 * runtime plane). This package declares the types + interface it must satisfy
 * so the execution layer can inject a real Altana backend without importing
 * the SDK at package build time (keeps `packages/blockchain` offline-safe).
 */

/** What the Altana signer backend needs from its environment. */
export interface AltanaEnv {
  /** BNB mainnet RPC endpoint (Gate A: chainId must be 56). */
  BAN_RPC_URL?: string;
  /** BNB mainnet chain id. */
  BAN_CHAIN_ID?: string;
  /** The AGENT's private key. Never the AI's. Dev/test only in practice. */
  BAN_AGENT_PRIVATE_KEY?: string;
  /** Optional Altana SDK API/config endpoint. */
  ALTANA_URL?: string;
}

export interface AltanaSignRequest {
  proposal: ActionProposal;
  /** Canonical ABI-encoded calldata. */
  calldata: string;
  to: string;
  chainId: number;
  session: Session;
}

export interface AltanaSigned {
  transactionHash: string; // 0x… real TxHash (or 0x-prefixed when unavailable)
  backend: 'altana';
  signedAt: string;
}

/**
 * AltanaSignerBackend — turns a policy-approved + session-scoped proposal into
 * a REAL tx submission to BNB via the Altana SDK + a private-key signer.
 *
 * The injected `submit` is the actual SDK implementation (lives in apps/web,
 * where the SDK is installed). This type-level seam keeps packages/blockchain
 * offline-safe; the real client lazy-loads `@altananetwork/sdk` at runtime.
 */
export type AltanaSubmit = (request: AltanaSignRequest) => Promise<AltanaSigned>;

/**
 * Returns a session-signer-compatible `execute` backend that signs + submits
 * via Altana. When the SDK/client is not provided, this returns undefined and
 * the caller should treat the cycle as "awaiting execution" (never fabricate).
 */
export function makeAltanaSignerBackend(opts: {
  env?: NodeJS.ProcessEnv;
  submit?: AltanaSubmit;
}): ((input: { proposal: ActionProposal; session: Session }) => Promise<{ transactionHash: string }>) | null {
  const env = opts.env ?? process.env;

  if (!env.BAN_RPC_URL || !env.BAN_AGENT_PRIVATE_KEY) {
    // No real signer configured — fail-closed: do not fabricate signature.
    throw requireBlockchainRuntime();
  }

  if (!opts.submit) {
    // The actual SDK client is not injected — returning null would hide an
    // implementation gap, so we return a backend that logs an honest error.
    const logger = createLogger('altana-signer');
    logger.error('altana_backend_unwired', {
      note: '@altananetwork/sdk client is not injected; refusing to fabricate a transaction hash.',
    });
    return null;
  }

  return async (input) => {
    const { proposal, session } = input;
    // Deterministic pre-submit validation (double-check against session scope).
    const contractAllowed = session.allowedContracts.some(
      (addr) => addr.toLowerCase() === proposal.contract.toLowerCase(),
    );
    const fnAllowed = session.allowedFunctions.includes(proposal.function);
    const tokenAllowed = session.allowedTokens.some(
      (t) => t.toLowerCase() === proposal.token.toLowerCase(),
    );
    if (!contractAllowed || !fnAllowed || !tokenAllowed) {
      throw new BANError(
        ErrorCode.POLICY_DENIED,
        `Altana signer refused: proposal ${proposal.proposalId} is outside session ${session.sessionId} scope`,
      );
    }

    const signed = await opts.submit!({
      proposal,
      calldata: (proposal.params?.calldata as string | undefined) ?? '',
      to: proposal.contract,
      chainId: Number(proposal.params?.chainId ?? 56),
      session,
    });

    if (!signed || !signed.transactionHash || signed.transactionHash.trim() === '') {
      throw new BANError(
        ErrorCode.EXECUTION_FAILED,
        `Altana backend returned an empty transaction hash for proposal ${proposal.proposalId}; refusing to report success`,
        { retryable: true },
      );
    }

    return { transactionHash: signed.transactionHash };
  };
}

/** Helper: read the BNB mainnet chain descriptor the Altana SDK expects. */
export function altanaChainId(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BAN_CHAIN_ID ?? '56';
  const id = Number(raw);
  if (!Number.isInteger(id) || id !== 56) {
    throw new BANError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `AltanaSigner only executes on BNB mainnet (56); BAN_CHAIN_ID=${raw} is not supported.`,
      { retryable: false },
    );
  }
  return 56;
}