/**
 * BAN live data smoke probe — read-only, real BNB mainnet.
 *
 * Builds the LiveDataProvider (seed registries included), Gate-A verifies the
 * RPC, then probes REAL data: prices (BNB/USDT/USDC), gas, a native balance,
 * Venus yield pools, a Venus lending position, and a PancakeSwap quote.
 *
 * Every probe is printed with its real value or an honest failure — nothing
 * is fabricated, nothing exits non-zero on a failed probe (partial results
 * are still informative). The only hard failure is missing BAN_RPC_URL or a
 * Gate-A verification mismatch (wrong chain), which the provider itself
 * throws.
 *
 * Usage:
 *   pnpm --filter @ban/blockchain run smoke:live [address]
 *
 *   BAN_RPC_URL must point at BNB mainnet (56). Optional address argument
 *   defaults to the PancakeSwap V3 Smart Router (holds real balances).
 */
import { PANCAKE_SWAP_ROUTER } from '@ban/registry';
import { LiveDataProvider } from '../live-provider.js';
function msg(err) {
    return err instanceof Error ? err.message : String(err);
}
async function main() {
    const address = process.argv[2]?.trim() || PANCAKE_SWAP_ROUTER;
    let provider;
    try {
        provider = LiveDataProvider.instance();
    }
    catch (err) {
        console.error(`[smoke] FATAL: LiveDataProvider could not be constructed: ${msg(err)}`);
        console.error('[smoke] Set BAN_RPC_URL to a BNB mainnet RPC (and BAN_CHAIN_ID=56) and retry.');
        process.exit(1);
    }
    try {
        await provider.verify();
        console.log('[smoke] Gate-A verified: RPC is BNB mainnet (chainId 56)');
    }
    catch (err) {
        console.error(`[smoke] FATAL: Gate-A verification failed: ${msg(err)}`);
        process.exit(1);
    }
    // 1) Prices (BNB / WBNB / USDT / USDC) — real CoinGecko, cached.
    for (const token of ['BNB', 'WBNB', 'USDT', 'USDC']) {
        try {
            const p = await provider.price.getTokenPrice(token);
            console.log(`[smoke] price ${token} = ${p.priceUsd} USD`);
        }
        catch (err) {
            console.log(`[smoke] price ${token} FAILED: ${msg(err)}`);
        }
    }
    // 2) Gas estimate (live RPC gas price + USD cost).
    try {
        const g = await provider.chain.getGasEstimate({ action: 'probe' });
        console.log(`[smoke] gas price = ${g.gasPriceGwei} gwei (est. ${g.estimatedCostUsd} USD)`);
    }
    catch (err) {
        console.log(`[smoke] gas FAILED: ${msg(err)}`);
    }
    // 3) Native BNB balance at the probe address (real read).
    try {
        const b = await provider.chain.getTokenBalance({ token: 'BNB', address });
        console.log(`[smoke] BNB balance ${address} = ${b.balance} wei (${b.balance === '0' ? 'empty — real zero' : 'funded'})`);
    }
    catch (err) {
        console.log(`[smoke] BNB balance FAILED: ${msg(err)}`);
    }
    // 4) Venus yield pools (supply APY + TVL, real vToken reads).
    try {
        const pools = await provider.yield.getYieldOpportunities('bnb-mainnet');
        console.log(`[smoke] venus pools: ${pools.length} read`);
        for (const p of pools)
            console.log(`  - ${p.asset}: apy ${p.apy}% tvl ${p.tvlUsd} USD`);
    }
    catch (err) {
        console.log(`[smoke] venus yield FAILED: ${msg(err)}`);
    }
    // 5) Venus lending position at the probe address (honest empty/none allowed).
    try {
        const pos = await provider.lending.getLendingPosition(address, 'venus');
        console.log(`[smoke] venus position ${address}: collateral=${pos.collateral} borrowed=${pos.borrowed} hf=${pos.healthFactor}`);
    }
    catch (err) {
        console.log(`[smoke] venus position FAILED: ${msg(err)}`);
    }
    // 6) PancakeSwap quote (WBNB → USDT, real router read). May legitimately
    // revert on low-liquidity pools — printed as an honest probe failure.
    try {
        const q = await provider.swap.getQuote({
            tokenIn: 'WBNB',
            tokenOut: 'USDT',
            amountIn: '10000000000000000', // 0.01 WBNB
            slippageBps: 100,
        });
        console.log(`[smoke] quote WBNB→USDT = ${q.amountOut} (route ${q.route.join(' → ')})`);
    }
    catch (err) {
        console.log(`[smoke] quote WBNB→USDT FAILED: ${msg(err)}`);
    }
    console.log('[smoke] probe complete (partial results above are real; failures are honest).');
    process.exit(0);
}
main().catch((err) => {
    console.error(`[smoke] UNEXPECTED: ${msg(err)}`);
    process.exit(1);
});
