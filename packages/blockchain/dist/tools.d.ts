import { z } from 'zod';
import type { ToolCapability } from '@ban/schemas';
import { ActionProposalSchema } from '@ban/schemas';
import type { ProtocolAdapterSet } from './index.js';
export interface ChainAdapter {
    getTokenBalance(input: {
        token: string;
        address: string;
    }): Promise<{
        token: string;
        address: string;
        balance: string;
        decimals: number;
        timestamp: string;
    }>;
    getGasEstimate(input: {
        action: string;
    }): Promise<{
        gasWei: string;
        gasPriceGwei: string;
        estimatedCostUsd: string;
        timestamp: string;
    }>;
    getTransactionStatus(hash: string): Promise<{
        status: 'CONFIRMED' | 'PENDING' | 'REVERTED';
        confirmations: number;
        timestamp: string;
    }>;
    simulateProposal(proposal: ReturnType<typeof ActionProposalSchema['parse']>): Promise<{
        ok: boolean;
        estimated?: {
            amountOut: string;
            priceImpactBps: number;
            route: string[];
        };
        gasWei?: string;
        revertReason?: string;
        timestamp: string;
    }>;
    /** Market volatility estimate in basis points. Derived from gas price or recent data. */
    getVolatilityBps?(input: {
        action: string;
    }): Promise<number>;
}
export type ToolAdapters = ProtocolAdapterSet & {
    chain: ChainAdapter;
};
export interface ToolHandle {
    readonly name: string;
    readonly description: string;
    readonly capabilityId: ToolCapability;
    readonly inputSchema: z.ZodTypeAny;
    invoke(input: unknown): Promise<Record<string, unknown>>;
}
export declare function buildToolHandles(adapters: ToolAdapters): ToolHandle[];
//# sourceMappingURL=tools.d.ts.map