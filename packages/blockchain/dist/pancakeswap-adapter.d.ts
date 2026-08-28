import { ContractRegistry, DeploymentRegistry, TokenRegistry, Eip55Validator, BnbAddressVerifier } from '@ban/registry';
import type { SwapAdapter } from './index.js';
/**
 * PancakeSwapAdapter — mustflow §16 protocol adapter, registry-enforced.
 *
 * Guarantees (all fail-closed, matching mustflow invariants §5/#10–13):
 *   - Only the VERIFIED router address from DeploymentRegistry may be targeted.
 *   - Only a DECLARED `EXECUTE` function may be used (never arbitrary calldata).
 *   - Both tokens must be verified AND enabled in TokenRegistry.
 *   - Slippage/deadline bounds must be sane.
 *   - Off-chain quote/simulate use only deterministic math or the injected
 *     `quoteProvider`/`simulator`; they NEVER return a fabricated "confirmed"
 *     transaction.
 *
 * The adapter is deliberately offline-safe: it imports no network transport and
 * never broadcasts. The execution engine's submit path adds the RPC/signature
 * layer separately (see provider.ts + signers package).
 */
export interface PancakeSwapDeps {
    deployments: DeploymentRegistry;
    contracts: ContractRegistry;
    tokens: TokenRegistry;
    /** Optional injected quote provider (RPC-backed or dev). If absent, `getQuote` throws (never fabricates). */
    quoteProvider?: {
        getAmountsOut(input: {
            router: string;
            amountIn: bigint;
            path: string[];
        }): Promise<bigint>;
    };
    /** Optional injected simulator (RPC-backed eth_call/poll). If absent, `simulate` returns { ok:false } (never fabricates). */
    simulator?: {
        simulate(input: {
            calldata: string;
            router: string;
            from: string;
        }): Promise<{
            ok: boolean;
            amountOut?: string;
            revertReason?: string;
        }>;
    };
}
export declare class PancakeSwapAdapter implements SwapAdapter {
    private readonly deps;
    private readonly logger;
    constructor(deps: PancakeSwapDeps);
    /** Resolve the verified router on the BAN chain (fail-closed). */
    private router;
    /** Validate a token id/address is verified + enabled. */
    private requireToken;
    /** Validate the target contract is the verified router + declared EXECUTE fn. */
    private requireExecutableRouter;
    /**
     * getQuote — off-chain deterministic quote. Only returns a value when a
     * quoteProvider is injected; otherwise throws (never fabricates).
     */
    getQuote(input: {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        slippageBps: number;
    }): Promise<{
        amountOut: string;
        priceImpactBps: number;
        route: string[];
        gasEstimate: string;
        timestamp: string;
    }>;
    /**
     * simulate — registry-enforced preflight. Builds only the canonical, encoded
     * call (never arbitrary calldata) and passes it to an injected simulator.
     * Without a simulator it returns { ok:false } rather than pretending success.
     */
    simulate(input: {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        slippageBps: number;
        deadline?: number;
    }): Promise<{
        ok: boolean;
        amountOut?: string;
        revertReason?: string;
    }>;
}
/** Registry-backed PancakeSwap adapter factory for a mainnet (56) setup. */
export declare function createPancakeSwapAdapter(deps: PancakeSwapDeps): PancakeSwapAdapter;
/** Re-export verification helpers so consumers can enable strict EIP-55 where desired. */
export { Eip55Validator, BnbAddressVerifier };
//# sourceMappingURL=pancakeswap-adapter.d.ts.map