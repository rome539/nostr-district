/**
 * priceService.ts — BTC/USD price feed
 * Fetches from mempool.space, caches for 5 minutes.
 */

const CACHE_TTL = 5 * 60 * 1000;
const PRICE_URL = 'https://mempool.space/api/v1/prices';

let _cachedPrice: number | null = null;
let _cacheTime   = 0;

/** Returns the current BTC/USD price, fetching if cache is stale. */
export async function getBtcUsdPrice(): Promise<number> {
  if (_cachedPrice !== null && Date.now() - _cacheTime < CACHE_TTL) {
    return _cachedPrice;
  }
  const res  = await fetch(PRICE_URL);
  const data = await res.json() as { USD: number };
  _cachedPrice = data.USD;
  _cacheTime   = Date.now();
  return _cachedPrice;
}

/** Converts a USD dollar amount to satoshis at the current BTC price. */
export async function usdToSats(usd: number): Promise<number> {
  const btcPrice = await getBtcUsdPrice();
  return Math.round((usd / btcPrice) * 1e8);
}
