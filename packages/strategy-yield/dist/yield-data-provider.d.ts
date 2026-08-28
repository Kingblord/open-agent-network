import type { YieldAdapter } from '@ban/blockchain';
import type { YieldOpportunity } from './types.js';
/**
 * M9 — YieldDataProvider.
 *
 * Thin, deterministic boundary adapter: pulls raw yield opportunities from the
 * underlying blockchain adapter and converts the one float-ish quantity (APY
 * percent) into integer basis points ONCE. Everything downstream is integer math.
 *
 * It wraps the `YieldAdapter` seam (never raw RPC) so the same provider works
 * against the dev provider now and a real BNB yield source later.
 */
export declare class YieldDataProvider {
    private readonly adapter;
    constructor(adapter: YieldAdapter);
    fetch(network: string): Promise<YieldOpportunity[]>;
}
//# sourceMappingURL=yield-data-provider.d.ts.map