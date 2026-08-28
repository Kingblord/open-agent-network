export class GridDataProvider {
    price;
    constructor(deps) {
        this.price = deps.price;
    }
    /**
     * Fetch the current price of a token (in integer cents USD).
     */
    async fetchPriceCents(token) {
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
//# sourceMappingURL=grid-data-provider.js.map