/**
 * M12 — GridDataProvider.
 *
 * Wraps the blockchain PriceDataAdapter to provide deterministic price
 * observations. This keeps the grid strategy framework-agnostic (no
 * direct RPC or adapter SDK imports).
 */
import type { PriceDataAdapter } from '@ban/blockchain';
import type { GridConfig } from './types.js';

export interface GridDataProviderDeps {
  price: PriceDataAdapter;
}

export class GridDataProvider {
  private readonly price: PriceDataAdapter;

  constructor(deps: GridDataProviderDeps) {
    this.price = deps.price;
  }

  /**
   * Fetch the current price of a token (in integer cents USD).
   */
  async fetchPriceCents(token: string): Promise<{ priceCents: number; humanReadable: string }> {
    const result = await this.price.getTokenPrice(token);
    // Convert float price string to integer cents
    const priceFloat = parseFloat(result.priceUsd);
    const priceCents = Math.round(priceFloat * 100);
    return {
      priceCents,
      humanReadable: result.priceUsd,
    };
  }
}