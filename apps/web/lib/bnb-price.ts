import 'server-only';

/**
 * Shared BNB → USD price lookup for the control plane.
 *
 * Used by the live on-chain balance endpoint (display) and the session
 * limit converter (mustflow §6 USD-denominated limits → wei). Never invents a
 * rate: when CoinGecko is unreachable we return null and callers fail closed
 * (show `—` or return an honest 503, never a fabricated conversion).
 */

let priceCache: { price: number; at: number } | null = null;

export async function getBnbUsdPrice(): Promise<number | null> {
  const now = Date.now();
  if (priceCache && now - priceCache.at < 60_000) return priceCache.price;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return priceCache?.price ?? null;
    const json = (await res.json()) as { binancecoin?: { usd?: unknown } };
    const price = Number(json?.binancecoin?.usd);
    if (!Number.isFinite(price) || price <= 0) return priceCache?.price ?? null;
    priceCache = { price, at: now };
    return price;
  } catch {
    return priceCache?.price ?? null;
  }
}