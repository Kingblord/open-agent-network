import { type Chain, type PublicClient, type WalletClient, type Transport } from 'viem';
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
export declare const bnbMainnet: Chain;
export interface BnbProvider {
    chainId: 56;
    publicClient: PublicClient;
    walletClient?: WalletClient;
    /** True when a live RPC connection was positively verified (Gate A passed). */
    verified: boolean;
}
/** BAN execution chain id — mainnet. Never returns testnet by default. */
export declare const BAN_MAINNET_CHAIN_ID = 56;
/**
 * Create a real BNB mainnet viem transport. Env-gated: without BAN_RPC_URL
 * this THROWS (fail-closed) rather than inventing a connection.
 */
export declare function resolveBnbTransport(env?: NodeJS.ProcessEnv): Transport;
/**
 * Gate A — verify the RPC is really BNB mainnet (chainId 56) BEFORE any
 * execution tooling touches it. Any other chain (incl. testnet 97) is refused.
 * This is deliberately a hard gate: BAN does not "run on mainnet trustingly";
 * it verifies the chain and aborts otherwise.
 */
export declare function assertBnbMainnet(publicClient: Pick<PublicClient, 'getChainId'>, opts?: {
    expectedChainId?: number;
    rpcUrl?: string;
}): Promise<void>;
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
export declare function createBnbProvider(opts?: {
    env?: NodeJS.ProcessEnv;
    /** Gate A always on for production; unit tests may inject a publicClient. */
    publicClient?: PublicClient;
    verifyChain?: boolean;
}): Promise<BnbProvider>;
/**
 * Dev/demo provider helper — returns the chain descriptor without any RPC.
 * Used by the deterministic DevDataProvider for offline tool tests. Never
 * claims to be connected; `verified` is always false.
 */
export declare function devBnbChain(): Chain;
//# sourceMappingURL=provider.d.ts.map