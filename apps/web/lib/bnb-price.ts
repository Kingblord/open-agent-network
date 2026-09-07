import 'server-only';

/**
 * Shared BNB → USD price lookup for the control plane.
 *
 * Resilience (fixes CoinGecko 429 killing live cycles):
 *   1. 60s in-process cache.
 *   2. Source chain: CoinGecko → Binance public ticker (no key) → PancakeSwap
 *      V3 USDT/WBNB pool price on-chain (no key, same RPC the app already uses).
 *   3. Stale-while-error: if every source fails, serve the last REAL observed
 *      price for up to 10 minutes, then null (callers fail closed — never a
 *      fabricated rate).
 */

const CACHE_TTL_MS = 60_000;
const STALE_MAX_MS = 10 * 60_000;

let priceCache: { price: number; at: number } | null = null;

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    clearTimeout(timeout);
    return res;
  } catch {
    return null;
  }
}

/** Source 1: CoinGecko simple price. */
async function fromCoinGecko(): Promise<number | null> {
  const res = await fetchWithTimeout(
    'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd',
    3000,
  );
  if (!res?.ok) return null;
  try {
    const json = (await res.json()) as { binancecoin?: { usd?: unknown } };
    const price = Number(json?.binancecoin?.usd);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Source 2: Binance public ticker (no key; generous free limits). */
async function fromBinance(): Promise<number | null> {
  const res = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT', 3000);
  if (!res?.ok) return null;
  try {
    const json = (await res.json()) as { price?: unknown };
    const price = Number(json?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Source 3: on-chain — USDT-per-WBNB from the PancakeSwap V3 factory pool. */
const POOL_ABI = [
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
] as const;
const FACTORY_ABI = [
  {
    name: 'getPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const;

const FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as const; // PancakeSwap V3 factory (BSC)
const USDT = '0x55d398326f99059fF775485246999027B3197955' as const;
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as const;
const Q96 = 2n ** 96n;

async function fromOnChainPool(): Promise<number | null> {
  try {
    const { createPublicClient, http } = await import('viem');
    const { bsc } = await import('viem/chains');
    const client = createPublicClient({
      chain: bsc,
      transport: http(process.env.BAN_RPC_URL || 'https://bsc-dataseed1.binance.org'),
    });

    // Tokens are sorted: USDT (0x55d3…) < WBNB (0xbb4C…) → token0 = USDT,
    // token1 = WBNB. slot0.sqrtPriceX96 encodes token1/token0.
    for (const fee of [500, 100, 2500, 10000]) {
      try {
        const pool = await client.readContract({
          address: FACTORY,
          abi: FACTORY_ABI,
          functionName: 'getPool',
          args: [USDT, WBNB, fee],
        });
        if (!pool || pool === '0x0000000000000000000000000000000000000000') continue;

        const slot0 = (await client.readContract({
          address: pool,
          abi: POOL_ABI,
          functionName: 'slot0',
        })) as unknown as readonly [bigint, number, number, number, number, number, boolean];
        const sqrtPriceX96 = slot0[0];
        if (sqrtPriceX96 <= 0n) continue;

        // rawPrice = (sqrtPriceX96 / 2^96)^2 → token1 per token0 (WBNB per USDT),
        // truncated to an integer. Scale before dividing to preserve precision.
        const rawPriceScaled = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / (Q96 * Q96); // WBNB per USDT × 1e18
        if (rawPriceScaled === 0n) continue;
        const wbnbPerUsdt = Number(rawPriceScaled) / 1e18;
        if (wbnbPerUsdt <= 0 || !Number.isFinite(wbnbPerUsdt)) continue;
        const usdPerWbnb = 1 / wbnbPerUsdt;
        if (Number.isFinite(usdPerWbnb) && usdPerWbnb > 0) return usdPerWbnb;
      } catch {
        continue; // try the next tier
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function getBnbUsdPrice(): Promise<number | null> {
  const now = Date.now();
  if (priceCache && now - priceCache.at < CACHE_TTL_MS) return priceCache.price;

  // Try sources in order; first success wins.
  const price = (await fromCoinGecko()) ?? (await fromBinance()) ?? (await fromOnChainPool());
  if (price != null) {
    priceCache = { price, at: now };
    return price;
  }

  // All sources failed — serve the last REAL price if fresh enough.
  if (priceCache && now - priceCache.at < STALE_MAX_MS) return priceCache.price;
  return null;
}