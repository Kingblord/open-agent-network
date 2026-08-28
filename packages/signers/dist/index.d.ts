import type { ActionProposal, Session } from '@ban/schemas';
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
export declare class SessionAuthorityResolver {
    /** The session that governs a proposal: exact sessionId must match. */
    resolve(proposal: ActionProposal, session: Session): Session;
}
export declare class SessionSigner {
    private readonly backend;
    private readonly resolver;
    private readonly logger;
    constructor(backend: SigningBackend | null, resolver?: SessionAuthorityResolver);
    /**
     * Sign a policy-approved proposal ONLY if it fits the session scope.
     * Throws (fail-closed) with the precise ErrorCode when any check fails.
     */
    sign(proposal: ActionProposal, context: SignerContext): Promise<SignedTransaction>;
}
//# sourceMappingURL=index.d.ts.map