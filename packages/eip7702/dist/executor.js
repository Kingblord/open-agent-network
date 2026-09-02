import { createWalletClient, http, } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BANError, ErrorCode, createLogger } from '@ban/shared';
import { BAN_MAINNET_CHAIN_ID, toAuthorizationTuple } from './authorization.js';
/**
 * EIP-7702 execution helper — builds the authorization list + submits the
 * delegation/activation transaction on BNB Mainnet (56), gated by env.
 *
 * Two distinct key-holders exist (never the AI's key):
 *   1. The AGENT wallet (per-agent Altana keystore) — the primary executor
 *      that ACTIVATES + executes the job, pays gas. Never owns user funds.
 *   2. `DEV_PRIVATE_KEY` — a developer-controlled mainnet key used ONLY for
 *      deployment + direct revocation testing. It is a call-site/dev gate:
 *      it must NEVER be read by production execution logic.
 *
 * This module is offline-safe: it only builds pure structures until a real
 * wallet/submit backend is injected, and it never fabricates a tx hash.
 */
const logger = createLogger('eip7702-executor');
/** The canonical BNB mainnet chain (chainId 56). */
export function eip7702Chain(env = process.env) {
    const rpc = env.BAN_RPC_URL?.trim();
    if (!rpc) {
        throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, 'BAN_RPC_URL is not configured; cannot build an EIP-7702 mainnet chain', { retryable: false });
    }
    const chainId = Number(env.BAN_CHAIN_ID ?? BAN_MAINNET_CHAIN_ID);
    if (chainId !== BAN_MAINNET_CHAIN_ID) {
        throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, `EIP-7702 executes on BNB MAINNET only (56); BAN_CHAIN_ID=${chainId} is not supported`, { retryable: false });
    }
    return {
        id: 56,
        name: 'BNB Smart Chain',
        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
        rpcUrls: { default: { http: [rpc] }, public: { http: [rpc] } },
        blockExplorers: { default: { name: 'BscScan', url: 'https://bscscan.com' } },
    };
}
/** Build the viem `AuthorizationList` for a single auth (raw tuple form). */
export function toAuthorizationList(auth) {
    return [toAuthorizationTuple(auth)];
}
/**
 * Read the DEV_PRIVATE_KEY as a wallet account — DEV/TEST ONLY.
 * Throws outside non-production so it can never be used by production
 * execution. Because this project has no BAN_ENV flag by design, we guard at
 * the single call site using NODE_ENV, and document that this must only ever
 * be invoked by dev/test/deploy/revocation tooling.
 */
export function devTestingAccount() {
    const key = process.env.DEV_PRIVATE_KEY?.trim();
    if (!key)
        return null;
    if (process.env.NODE_ENV === 'production') {
        throw new BANError(ErrorCode.INTERNAL, 'DEV_PRIVATE_KEY is a dev/test-only key; refusing to use it in production (NODE_ENV=production)', { retryable: false });
    }
    try {
        const account = privateKeyToAccount(key);
        const transport = http(eip7702Chain().rpcUrls.default.http[0]);
        const walletClient = createWalletClient({
            chain: eip7702Chain(),
            transport,
            account,
        });
        return { address: account.address, walletClient };
    }
    catch (err) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `DEV_PRIVATE_KEY is not a valid private key: ${err instanceof Error ? err.message : String(err)}`, { retryable: false });
    }
}
/** Read the agent-wallet private key as a wallet account (primary executor). */
export function agentWalletAccount(env = process.env) {
    const key = env.BAN_AGENT_PRIVATE_KEY?.trim() ?? env.DEV_PRIVATE_KEY?.trim();
    if (!key)
        return null;
    try {
        const account = privateKeyToAccount(key);
        const transport = http(eip7702Chain(env).rpcUrls.default.http[0]);
        const walletClient = createWalletClient({ chain: eip7702Chain(env), transport, account });
        return { address: account.address, walletClient };
    }
    catch (err) {
        throw new BANError(ErrorCode.VALIDATION_FAILED, `Agent wallet private key is not valid: ${err instanceof Error ? err.message : String(err)}`, { retryable: false });
    }
}
/**
 * Submit an EIP-7702 activation transaction from a signing account using an
 * injected viem submit backend. The broadcast step (RPC) is intentionally a
 * separate concern so hermetic tests can prove the transaction is built
 * without touching a network, and this never fabricates a tx hash.
 */
export async function submitAuthorization(input) {
    if (!input.submit) {
        throw new BANError(ErrorCode.INTERNAL, 'No EIP-7702 submit backend provided; refusing to fabricate a transaction hash', { retryable: false });
    }
    const authList = toAuthorizationList(input.auth);
    logger.info('eip7702_submission_prepared', {
        chainId: input.auth.chainId,
        delegate: input.auth.address,
        authCount: authList.length,
    });
    return input.submit({ authList, data: input.data ?? undefined });
}
