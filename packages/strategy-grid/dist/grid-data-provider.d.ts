/**
 * M12 — GridDataProvider.
 *
 * Wraps the blockchain PriceDataAdapter to provide deterministic price
 * observations. This keeps the grid strategy framework-agnostic (no
 * direct RPC or adapter SDK imports).
 */
import type { PriceDataAdapter } from '@ban/blockchain';
export interface GridDataProviderDeps {
    price: PriceDataAdapter;
}
export declare class GridDataProvider {
    private readonly price;
    constructor(deps: GridDataProviderDeps);
    /**
     * Fetch the current price of a token (in integer cents USD), with a
     * human-readable USD string for the AI observation layer.
     */
    fetchPriceCents(token: string): Promise<{
        priceCents: number;
        humanReadable: string;
    }>;
}
//# sourceMappingURL=grid-data-provider.d.ts.map