import type { ActionProposal, Session } from '@ban/schemas';
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
    transactionHash: string;
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
export declare function makeAltanaSignerBackend(opts: {
    env?: NodeJS.ProcessEnv;
    submit?: AltanaSubmit;
}): ((input: {
    proposal: ActionProposal;
    session: Session;
}) => Promise<{
    transactionHash: string;
}>) | null;
/** Helper: read the BNB mainnet chain descriptor the Altana SDK expects. */
export declare function altanaChainId(env?: NodeJS.ProcessEnv): number;
//# sourceMappingURL=altana-signer.d.ts.map