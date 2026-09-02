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
   * Fetch the current price of a token (in integer cents USD), with a
   * human-readable USD string for the AI observation layer.
   */
  async fetchPriceCents(token: string): Promise<{ priceCents: number; humanReadable: string }> {
    const result = await this.price.getTokenPrice(token);
    // Convert float price string to integer cents
    const priceFloat = parseFloat(result.priceUsd);
    const priceCents = Math.round(priceFloat * 100);
    // USD dollars with thousands separator and explicit USD suffix, avoiding
    // any "687.06 cents" ambiguity in the AI observation.
    const humanReadable = `$${priceFloat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return {
      priceCents,
      humanReadable,
    };
  }
}