import { BANError, ErrorCode, createLogger } from '@ban/shared';
import { requireBlockchainRuntime } from './index.js';
/**
 * Returns a session-signer-compatible `execute` backend that signs + submits
 * via Altana. When the SDK/client is not provided, this returns undefined and
 * the caller should treat the cycle as "awaiting execution" (never fabricate).
 */
export function makeAltanaSignerBackend(opts) {
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
        const contractAllowed = session.allowedContracts.some((addr) => addr.toLowerCase() === proposal.contract.toLowerCase());
        const fnAllowed = session.allowedFunctions.includes(proposal.function);
        const tokenAllowed = session.allowedTokens.some((t) => t.toLowerCase() === proposal.token.toLowerCase());
        if (!contractAllowed || !fnAllowed || !tokenAllowed) {
            throw new BANError(ErrorCode.POLICY_DENIED, `Altana signer refused: proposal ${proposal.proposalId} is outside session ${session.sessionId} scope`);
        }
        const signed = await opts.submit({
            proposal,
            calldata: proposal.params?.calldata ?? '',
            to: proposal.contract,
            chainId: Number(proposal.params?.chainId ?? 56),
            session,
        });
        if (!signed || !signed.transactionHash || signed.transactionHash.trim() === '') {
            throw new BANError(ErrorCode.EXECUTION_FAILED, `Altana backend returned an empty transaction hash for proposal ${proposal.proposalId}; refusing to report success`, { retryable: true });
        }
        return { transactionHash: signed.transactionHash };
    };
}
/** Helper: read the BNB mainnet chain descriptor the Altana SDK expects. */
export function altanaChainId(env = process.env) {
    const raw = env.BAN_CHAIN_ID ?? '56';
    const id = Number(raw);
    if (!Number.isInteger(id) || id !== 56) {
        throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, `AltanaSigner only executes on BNB mainnet (56); BAN_CHAIN_ID=${raw} is not supported.`, { retryable: false });
    }
    return 56;
}
