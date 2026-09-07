/**
 * BAN Blockchain data-plane interfaces (Milestone 6 adapter seams).
 *
 * Strategies depend on these adapters — never on raw RPC or scattered SDK
 * calls. The AI never accesses these directly; tools wrap them.
 */
export interface PriceDataAdapter {
    getTokenPrice(token: string): Promise<{
        asset: string;
        priceUsd: string;
        timestamp: string;
    }>;
}
export interface YieldAdapter {
    getYieldOpportunities(network: string): Promise<Array<{
        asset: string;
        protocol: string;
        apy: number;
        tvlUsd: string;
        risk: 'LOW' | 'MEDIUM' | 'HIGH';
        timestamp: string;
    }>>;
}
export interface LendingAdapter {
    getLendingPosition(address: string, protocol: string): Promise<{
        collateral: string;
        borrowed: string;
        /** Per-underlying debt (wei), symbol-keyed — lets a REPAY candidate target the correct vToken. */
        borrowedByToken?: Record<string, string>;
        ltv: number;
        liquidationThreshold: number;
        healthFactor: number;
        timestamp: string;
    }>;
}
export interface LiquidityAdapter {
    getPoolState(poolAddress: string): Promise<{
        token0: string;
        token1: string;
        fee: number;
        sqrtPriceX96: string;
        tick: number;
        liquidity: string;
        volumeUsd24h: string;
        timestamp: string;
    }>;
    getPoolPosition(poolAddress: string, owner: string): Promise<{
        positionId: string;
        lowerTick: number;
        upperTick: number;
        liquidity: string;
        token0Amount: string;
        token1Amount: string;
        feesUsd: string;
        timestamp: string;
    }>;
}
export interface SwapAdapter {
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
    simulate(input: {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        slippageBps: number;
    }): Promise<{
        ok: boolean;
        amountOut?: string;
        revertReason?: string;
    }>;
}
export type ProtocolAdapterSet = {
    price: PriceDataAdapter;
    yield: YieldAdapter;
    lending: LendingAdapter;
    liquidity: LiquidityAdapter;
    swap: SwapAdapter;
};
/**
 * viem-backed provider factory (BNB mainnet - chainId 56). This file does not
 * initialize a provider at import time — only when the execution layer calls it,
 * so dev/demo environments without RPC access remain functional.
 *
 * The factory is fail-closed: when BAN_RPC_URL / BAN_CHAIN_ID are not configured
 * (or point to a chain other than mainnet 56 when production is enforced), it
 * refuses to start rather than silently talking to the wrong network.
 */
export declare function requireBlockchainRuntime(): never;
export declare const blockchainLogger: import("@ban/shared").StructuredLogger;
export { DevDataProvider } from './dev-provider.js';
export type { ToolAdapters, ChainAdapter, ToolHandle } from './tools.js';
export { buildToolHandles } from './tools.js';
export { LiveDataProvider, type LiveProviderDeps } from './live-provider.js';
//# sourceMappingURL=index.d.ts.map