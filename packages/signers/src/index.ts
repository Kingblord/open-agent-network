import type { ActionProposal, Session } from '@ban/schemas';
import { BANError, ErrorCode, createLogger } from '@ban/shared';
import { ContractRegistry, TokenRegistry } from '@ban/registry';

/**
 * SessionSigner — mustflow §26–28 scoped session authority boundary.
 *
 * The SessionSigner is the ONLY component that can produce a signed
 * transaction for an agent, and its authority is strictly bounded by an
 * ACTIVE Session:
 *   - session must be ACTIVE and unexpired,
 *   - proposal.contract must be in session.allowedContracts,
 *   - proposal.function must be in session.allowedFunctions,
 *   - proposal.token must be in session.allowedTokens,
 *   - proposal.amount ≤ session.perTransactionCap,
 *   - (optional) registry checks: contract registered + EXECUTE-capable,
 *     token verified + enabled.
 *
 * It NEVER holds the private key. Actual signing is delegated to an injected
 * `sign` backend (viem wallet / Altana / dev). The signer also never
 * fabricates a signature: if the backend is absent or returns an empty hash,
 * it throws instead of pretending success.
 *
 * All checks are deterministic and offline-safe; the package has no network
 * dependency.
 */

export interface SignerContext {
  session: Session;
  /** Registry-backed contract allowlist (optional but recommended). */
  contracts?: ContractRegistry;
  /** Registry-backed token allowlist (optional but recommended). */
  tokens?: TokenRegistry;
}

export interface SignRequest {
  proposal: ActionProposal;
  /** Canonical ABI-encoded calldata (produced by a registry-enforced adapter or validated proposal builder). */
  calldata: string;
  /** Target contract address (must equal proposal.contract). */
  to: string;
  /** Chain id the signature is scoped to. */
  chainId: number;
}

export interface SignedTransaction {
  /** Hex signature returned by the backend. */
  signature: string;
  /** Backend name (e.g. 'viem', 'altana', 'dev') for audit. */
  backend: string;
  /** When the signature was produced. */
  signedAt: string;
}

/** Injected signing backend — never a key owner, never a fabricator. */
export type SigningBackend = (request: SignRequest) => Promise<SignedTransaction>;

/** Resolves which session wallet/backend may sign for a proposal. */
export class SessionAuthorityResolver {
  /** The session that governs a proposal: exact sessionId must match. */
  resolve(proposal: ActionProposal, session: Session): Session {
    if (proposal.sessionId !== session.sessionId) {
      throw new BANError(ErrorCode.SESSION_REVOKED, `Proposal ${proposal.proposalId} references session ${proposal.sessionId}, not ${session.sessionId}`);
    }
    if (session.status !== 'ACTIVE') {
      throw new BANError(ErrorCode.SESSION_REVOKED, `Session ${session.sessionId} is ${session.status}, not ACTIVE`);
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new BANError(ErrorCode.SESSION_EXPIRED, `Session ${session.sessionId} expired at ${session.expiresAt}`);
    }
    return session;
  }
}

export class SessionSigner {
  private readonly logger = createLogger('session-signer');

  constructor(
    private readonly backend: SigningBackend | null,
    private readonly resolver = new SessionAuthorityResolver(),
  ) {}

  /**
   * Sign a policy-approved proposal ONLY if it fits the session scope.
   * Throws (fail-closed) with the precise ErrorCode when any check fails.
   */
  async sign(proposal: ActionProposal, context: SignerContext): Promise<SignedTransaction> {
    const session = this.resolver.resolve(proposal, context.session);

    // Contract allowlist — exact match against session.allowedContracts.
    const contractAllowed = session.allowedContracts.some(
      (addr) => addr.toLowerCase() === proposal.contract.toLowerCase(),
    );
    if (!contractAllowed) {
      throw new BANError(
        ErrorCode.CONTRACT_NOT_ALLOWED,
        `Contract ${proposal.contract} is not in session ${session.sessionId} allowlist`,
      );
    }

    // Function allowlist.
    if (!session.allowedFunctions.includes(proposal.function)) {
      throw new BANError(
        ErrorCode.FUNCTION_NOT_ALLOWED,
        `Function ${proposal.function} is not allowed by session ${session.sessionId}`,
      );
    }

    // Token allowlist.
    const tokenAllowed = session.allowedTokens.some(
      (t) => t.toLowerCase() === proposal.token.toLowerCase(),
    );
    if (!tokenAllowed) {
      throw new BANError(
        ErrorCode.TOKEN_NOT_ALLOWED,
        `Token ${proposal.token} is not allowed by session ${session.sessionId}`,
      );
    }

    // Per-transaction cap (wei-decimal string comparison via BigInt).
    const amount = BigInt(proposal.amount || '0');
    const cap = BigInt(session.perTransactionCap || '0');
    if (amount > cap) {
      throw new BANError(
        ErrorCode.SPEND_LIMIT_EXCEEDED,
        `Amount ${proposal.amount} exceeds per-transaction cap ${session.perTransactionCap} of session ${session.sessionId}`,
      );
    }

    // Registry fail-closed checks (when registries provided).
    if (context.contracts && !context.contracts.canExecute(proposal.contract, proposal.function)) {
      throw new BANError(
        ErrorCode.CONTRACT_NOT_ALLOWED,
        `Contract ${proposal.contract} function ${proposal.function} is not EXECUTE-capable in the registry`,
      );
    }
    if (context.tokens && !context.tokens.isEnabled(proposal.token)) {
      throw new BANError(
        ErrorCode.TOKEN_NOT_ALLOWED,
        `Token ${proposal.token} is not verified+enabled in the registry`,
      );
    }

    // Backend must exist — never fabricate a signature.
    if (!this.backend) {
      throw new BANError(
        ErrorCode.INTERNAL,
        `No signing backend configured for session ${session.sessionId}; refusing to fabricate a signature`,
        { retryable: false },
      );
    }

    const signed = await this.backend({
      proposal,
      calldata: proposal.params?.calldata as string | undefined ?? '',
      to: proposal.contract,
      chainId: Number(proposal.params?.chainId ?? 56),
    });

    if (!signed || !signed.signature || signed.signature.trim() === '') {
      throw new BANError(
        ErrorCode.EXECUTION_FAILED,
        `Signing backend returned an empty signature for proposal ${proposal.proposalId}; refusing to report success`,
        { retryable: true },
      );
    }

    this.logger.info('session_signed', {
      sessionId: session.sessionId,
      proposalId: proposal.proposalId,
      backend: signed.backend,
      contract: proposal.contract,
      function: proposal.function,
    });
    return signed;
  }
}