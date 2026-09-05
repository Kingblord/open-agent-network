/**
 * Idempotent, exact-anchor patch — B: make the live price adapter resolve the
 * BAN P0 token ADDRESSES (LiquidityAdapter.getPoolState returns token0/token1
 * as addresses) to their CoinGecko ids, in addition to the existing symbol
 * lookup. Anything outside the verified P0 set (incl. unknown addresses) still
 * throws PROVIDER_UNAVAILABLE — never a fabricated rate.
 *
 * Usage: node scripts/patch-live-price.mjs
 * Safe to re-run: no-op when already applied, exits non-zero on anchor drift.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../packages/blockchain/src/live-provider.ts');
const src = readFileSync(target, 'utf8');

const PRICE_ANCHOR = `const COINGECKO_IDS: Record<string, string> = {
  BNB: 'binancecoin',
  WBNB: 'binancecoin',
  USDT: 'tether',
  USDC: 'usd-coin',
};`;

const ADDRESS_MAP = PRICE_ANCHOR + `

/**
 * BAN P0 token addresses (lowercase) → CoinGecko id. The live pool reader
 * prices tokens BY ADDRESS (LiquidityAdapter.getPoolState returns token0/token1
 * as addresses), so a pool of any P0 asset resolves a real USD price. Anything
 * outside the verified P0 set fails closed (PROVIDER_UNAVAILABLE) — never a
 * fabricated rate.
 */
const COINGECKO_BY_ADDRESS: Record<string, string> = {
  '0x0000000000000000000000000000000000000000': 'binancecoin', // BNB (native)
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'binancecoin', // WBNB
  '0x55d398326f99059ff775485246999027b3197955': 'tether', // BSC-USD
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'usd-coin', // BSC-USDC
};`;

const FN_OLD = `  async getTokenPrice(token: string): Promise<{ asset: string; priceUsd: string; timestamp: string }> {
    const key = token.toUpperCase();
    const coinId = COINGECKO_IDS[key];
    if (!coinId) {`;

const FN_NEW = `  async getTokenPrice(token: string): Promise<{ asset: string; priceUsd: string; timestamp: string }> {
    const raw = token.trim();
    const isAddress = raw.toLowerCase().startsWith('0x');
    const key = isAddress ? raw.toLowerCase() : raw.toUpperCase();
    const coinId = isAddress ? COINGECKO_BY_ADDRESS[key] : COINGECKO_IDS[key];
    if (!coinId) {`;

let out = src;
let count = 0;

if (!out.includes('COINGECKO_BY_ADDRESS')) {
  if (!out.includes(PRICE_ANCHOR)) {
    console.error('anchor COINGECKO_IDS block not found — aborting (no change)');
    process.exit(1);
  }
  out = out.replace(PRICE_ANCHOR, ADDRESS_MAP);
  count++;
}

if (!out.includes('isAddress ? COINGECKO_BY_ADDRESS[key]')) {
  if (!out.includes(FN_OLD)) {
    console.error('anchor getTokenPrice header not found — aborting (no change)');
    process.exit(1);
  }
  out = out.replace(FN_OLD, FN_NEW);
  count++;
}

if (count === 0) {
  console.log('patch already applied; no change');
  process.exit(0);
}

writeFileSync(target, out, 'utf8');
console.log(`patched packages/blockchain/src/live-provider.ts (${count} replacement${count === 1 ? '' : 's'}); all other bytes untouched`);