import type { AgentPermission, DelegationAuthorization } from '@ban/schemas';
import { ContractRegistry, TokenRegistry } from '@ban/registry';
/**
 * @ban/eip7702 — one-signature autonomous agent authorization (EIP-7702).
 *
 * A user EOA delegates execution to BAN permission code via a single EIP-7702
 * authorization tuple. The user stays the protocol identity and funds stay in
 * the user's wallet; the per-agent Altana wallet is the executor that submits
 * the activation transaction and per-job execution transactions, paying gas.
 *
 * This package is runtime-agnostic (no Next.js/Firebase dependency) and
 * offline-safe: every check is deterministic. It provides:
 *   - `DelegationAuthorizationBuilder` — how the one-time authorization tuple
 *     is produced (chain, impl address, EOA nonce).
 *   - `DelegationAuthorizationVerifier` — how a submitted tuple is recovered
 *     and bound to a permission record (singer must equal the user, the impl
 *     must be the expected permission account, the chain must match).
 *   - `PermissionResolver` — fail-closed: every policy-checked proposal must
 *     resolve to an ACTIVE permission within scope, else DENIED.
 *
 * The actual viem signer (which calls prepareAuthorization/signAuthorization)
 * is injected as a `SignerBackend` — this package never holds a private key and
 * never fabricates a signature. Concrete viem wiring lands in Phase 3.
 */
export type AuthorizationTuple = DelegationAuthorization;
export { EIP7702_AUTHORIZATION_TYPE, BAN_MAINNET_CHAIN_ID } from './authorization.js';
export { toAuthorizationTuple, fromAuthorizationTuple, eip7702Digest, computeAuthority, buildDelegationState, delegationStateFromPermission, } from './authorization.js';
export { toAuthorizationList, eip7702Chain, submitAuthorization, devTestingAccount, agentWalletAccount, type Eip7702ExecutorEnv, } from './executor.js';
export { permissionConfigHash, withConfigHash, } from './permission-binding.js';
export { assertActivatable, delegationForPermission, assertAuthorityMatches, nextPermissionNonce, } from './delegation.js';
export { recoverAuthorizationSigner, verifyAuthorizationSigner, verifyAuthorizationForPermission, } from './verification.js';
export declare const EIP7702ErrorCodes: {
    readonly SIGNER_MISMATCH: "ERR_EIP7702_SIGNER_MISMATCH";
    readonly CHAIN_MISMATCH: "ERR_EIP7702_CHAIN_MISMATCH";
    readonly IMPL_MISMATCH: "ERR_EIP7702_IMPL_MISMATCH";
    readonly NOT_ACTIVE: "ERR_EIP7702_NOT_ACTIVE";
    readonly EXPIRED: "ERR_EIP7702_EXPIRED";
    readonly SPEND_LIMIT_EXCEEDED: "ERR_EIP7702_SPEND_LIMIT_EXCEEDED";
    readonly PERMISSION_NOT_FOUND: "ERR_EIP7702_PERMISSION_NOT_FOUND";
    readonly UNVERIFIED: "ERR_EIP7702_UNVERIFIED";
};
export type EIP7702ErrorCode = (typeof EIP7702ErrorCodes)[keyof typeof EIP7702ErrorCodes];
export declare class EIP7702Error extends Error {
    readonly code: EIP7702ErrorCode;
    retryable: boolean;
    constructor(code: EIP7702ErrorCode, message: string, opts?: {
        retryable?: boolean;
    });
}
export declare function isEIP7702Error(err: unknown): err is EIP7702Error;
export interface BuildAuthorizationInput {
    /** The EOA (user) performing the delegation. */
    address: string;
    /** The BAN permission implementation contract the EOA delegates to. */
    implAddress: string;
    /** The chain id the authorization is scoped to (BAN_CHAIN_ID). */
    chainId: number;
}
/**
 * Injected signer — produces the EIP-7702 authorization tuple. This is the
 * ONLY component that touches a private key (the user's EOA during onboarding,
 * or a test key via `signAuthorization` in Phase 3). It never fabricates: if
 * signing fails, it throws.
 */
export type AuthorizationSignerBackend = (input: BuildAuthorizationInput & {
    nonce: bigint;
}) => Promise<AuthorizationTuple>;
export declare class DelegationAuthorizationBuilder {
    private readonly signer;
    private readonly logger;
    constructor(signer: AuthorizationSignerBackend);
    /**
     * Build the one-time authorization tuple for a user EOA delegating to the
     * BAN permission account. `nonce` is the user EOA's current nonce (read at
     * signing time; the executor uses it to submit the activation transaction).
     */
    build(input: BuildAuthorizationInput, nonce: bigint): Promise<AuthorizationTuple>;
}
export interface VerifyAuthorizationInput {
    /** The permission record the authorization is meant to satisfy. */
    permission: AgentPermission;
    /** The chain id this authorization was scoped to (from config). */
    chainId: number;
    /** The address the permission implementation is deployed at (from config). */
    implAddress: string;
    /** The expected user EOA (permission.userId → `address`). */
    expectedUser: string;
}
export interface VerifyResult {
    /** The address recovered from the authorization tuple. */
    signer: string;
    /** Whether the tuple's signer matches the expected user. */
    signerMatchesUser: boolean;
}
/**
 * The delegator's signer recovery + binding. In production this wraps viem's
 * `recoverAuthorizationAddress` / `verifyAuthorization` (Phase 3). At this
 * phase it stays a pure, injected seam so the package builds offline: a
 * `RecoverBackend` must be provided that returns the recovered signer.
 */
export type RecoverBackend = (auth: AuthorizationTuple) => Promise<string>;
export declare class DelegationAuthorizationVerifier {
    private readonly recover;
    private readonly logger;
    constructor(recover: RecoverBackend);
    verify(input: VerifyAuthorizationInput): Promise<VerifyResult>;
}
export interface PermissionScopeCheck {
    /** The ActionProposal fields the permission must cover. */
    protocol: string;
    contract: string;
    functionName: string;
    token: string;
    amount: string;
}
export interface PermissionResolverOpts {
    /** Registry-backed contract allowlist (fail-closed). Optional. */
    contracts?: ContractRegistry;
    /** Registry-backed token allowlist (fail-closed). Optional. */
    tokens?: TokenRegistry;
}
/**
 * Resolves a policy-checked proposal to an ACTIVE permission and verifies the
 * proposal is within scope (protocol/contract/function/token/spend). Fails
 * closed — any missing/expired/revoked permission or out-of-scope field throws
 * an EIP7702Error.
 */
export declare class PermissionResolver {
    private readonly opts;
    private readonly logger;
    constructor(opts?: PermissionResolverOpts);
    resolve(permission: AgentPermission | null, scope: PermissionScopeCheck): AgentPermission;
}
export type { AgentPermission, DelegationAuthorization };
//# sourceMappingURL=index.d.ts.map