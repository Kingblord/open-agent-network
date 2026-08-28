import { createPublicClient, createWalletClient, http } from 'viem';
import { defineChain } from 'viem';
import { BANError, ErrorCode, createLogger } from '@ban/shared';
import { requireBlockchainRuntime } from './index.js';
/**
 * BNB Smart Chain mainnet (chainId 56) — mustflow §9/§38 mainnet gate.
 *
 * BAN executes on BNB MAINNET (56). The production provider is only created
 * when:
 *   1. `BAN_RPC_URL` is set (a real RPC endpoint — never fabricated), AND
 *   2. the chain actually reports chainId === 56 (Gate A).
 *
 * If either condition is not met this factory throws via
 * `requireBlockchainRuntime()` — it NEVER returns a stub, a fake, or a
 * testnet provider pretending to be mainnet. Offline builds/tests never touch
 * this path (the factory is only invoked by the execution layer when an
 * onchain action is requested).
 *
 * Mustflow §15: viem is the EVM SDK at the chain boundary.
 */
export const bnbMainnet = defineChain({
    id: 56,
    name: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: {
        default: { http: [process.env.BAN_RPC_URL].filter(Boolean) },
        public: { http: [process.env.BAN_RPC_URL].filter(Boolean) },
    },
    blockExplorers: {
        default: { name: 'BscScan', url: 'https://bscscan.com' },
    },
});
const logger = createLogger('blockchain-provider');
/** BAN execution chain id — mainnet. Never returns testnet by default. */
export const BAN_MAINNET_CHAIN_ID = 56;
/**
 * Create a real BNB mainnet viem transport. Env-gated: without BAN_RPC_URL
 * this THROWS (fail-closed) rather than inventing a connection.
 */
export function resolveBnbTransport(env = process.env) {
    const rpcUrl = env.BAN_RPC_URL;
    if (!rpcUrl || rpcUrl.trim() === '') {
        throw requireBlockchainRuntime(); // ERR_INTERNAL, retryable:false
    }
    return http(rpcUrl.trim());
}
/**
 * Gate A — verify the RPC is really BNB mainnet (chainId 56) BEFORE any
 * execution tooling touches it. Any other chain (incl. testnet 97) is refused.
 * This is deliberately a hard gate: BAN does not "run on mainnet trustingly";
 * it verifies the chain and aborts otherwise.
 */
export async function assertBnbMainnet(publicClient, opts = {}) {
    const expected = opts.expectedChainId ?? BAN_MAINNET_CHAIN_ID;
    let actual;
    try {
        actual = await publicClient.getChainId();
    }
    catch (err) {
        throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, `Cannot reach BNB RPC${opts.rpcUrl ? ` (${opts.rpcUrl})` : ''}: ${err.message}`, { retryable: true });
    }
    if (actual !== expected) {
        throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, `Gate A failed: RPC reports chainId ${actual}, but BAN only executes on BNB mainnet (${expected}). Refusing to start.`, { retryable: true });
    }
    logger.info('gate_a_verified', { chainId: actual, rpcUrl: opts.rpcUrl ?? 'default' });
}
/**
 * Create the real BNB mainnet provider. Env-gated + chain-verified.
 * - no BAN_RPC_URL          → throw (requireBlockchainRuntime, offline-safe)
 * - RPC unreachable         → throw PROVIDER_UNAVAILABLE
 * - RPC reports chainId≠56  → throw PROVIDER_UNAVAILABLE (Gate A)
 * - ok                      → { chainId:56, publicClient, verified:true }
 *
 * `verifyChain` defaults to true. In hermetic unit tests, pass a mock client
 * or set `verifyChain:false` only for shape tests (never for production paths).
 */
export async function createBnbProvider(opts = {}) {
    const env = opts.env ?? process.env;
    const rpcUrl = opts.publicClient ? undefined : () => resolveBnbTransport(env);
    void rpcUrl; // transport resolved only when creating clients below
    const transport = opts.publicClient ? undefined : resolveBnbTransport(env);
    const publicClient = opts.publicClient ??
        createPublicClient({
            chain: bnbMainnet,
            transport: transport,
        });
    const walletClient = opts.publicClient
        ? undefined
        : createWalletClient({
            chain: bnbMainnet,
            transport: transport,
        });
    if (opts.verifyChain === false) {
        return { chainId: 56, publicClient, walletClient, verified: false };
    }
    await assertBnbMainnet(publicClient, { rpcUrl: opts.publicClient ? undefined : env.BAN_RPC_URL });
    return { chainId: 56, publicClient, walletClient, verified: true };
}
/**
 * Dev/demo provider helper — returns the chain descriptor without any RPC.
 * Used by the deterministic DevDataProvider for offline tool tests. Never
 * claims to be connected; `verified` is always false.
 */
export function devBnbChain() {
    return bnbMainnet;
}
