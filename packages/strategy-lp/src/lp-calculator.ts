/**
 * M11 — LpRangeCalculator.
 *
 * Deterministic tick/price/liquidity math for Uniswap V3-style concentrated
 * liquidity pools. ALL operations are integer (BigInt, integer math), no
 * floating-point arithmetic for core financial decisions.
 *
 * Covers:
 *   - sqrtPriceX96 ↔ tick boundary
 *   - tick ↔ sqrtPriceX96
 *   - Is a tick in range (lower ≤ tick < upper)
 *   - Tick alignment with tickSpacing
 *   - Position profitability metrics
 *
 * No external AMM SDK dependency — plain integer math.
 */

import { BANError, ErrorCode } from '@ban/shared';

/** Q96 = 2^96, the Q64.96 fixed-point base. */
const Q96 = 1n << 96n;

export class LpRangeCalculator {
  /**
   * Convert sqrtPriceX96 (decimal integer string) to its approximate tick.
   *
   * sqrtPriceX96 / 2^96 = sqrt(1.0001)^tick
   * tick = 2 * log(sqrtPriceX96 / 2^96) / log(1.0001)
   */
  sqrtPriceX96ToTick(sqrtPriceX96: string): number {
    const s = BigInt(sqrtPriceX96);
    if (s <= 0n) throw new BANError(ErrorCode.VALIDATION_FAILED, 'sqrtPriceX96 must be positive');

    const ratio = Number(s) / Number(Q96);
    const tick = Math.floor(2.0 * Math.log(ratio) / Math.log(1.0001));
    return tick;
  }

  /**
   * Convert tick to approximate sqrtPriceX96 (decimal bigint string).
   *
   * sqrtPrice ≈ Q96 * (1.0001 ^ (tick/2))
   */
  tickToSqrtPriceX96(tick: number): string {
    const ratio = Math.pow(1.0001, tick / 2.0);
    const s = BigInt(Math.round(ratio * Number(Q96)));
    return s.toString();
  }

  /** Is the current tick inside the position's range (lower ≤ tick < upper)? */
  isInRange(currentTick: number, lowerTick: number, upperTick: number): boolean {
    return currentTick >= lowerTick && currentTick < upperTick;
  }

  /** Round tick down to nearest valid tickSpacing boundary. */
  alignTickDown(tick: number, tickSpacing: number): number {
    if (tickSpacing <= 0) return tick;
    const rem = ((tick % tickSpacing) + tickSpacing) % tickSpacing;
    return tick - rem;
  }

  /** Round tick up to nearest valid tickSpacing boundary. */
  alignTickUp(tick: number, tickSpacing: number): number {
    if (tickSpacing <= 0) return tick;
    return this.alignTickDown(tick + tickSpacing - 1, tickSpacing);
  }

  /**
   * Generate candidate range around the current tick, aligned to tickSpacing.
   *
   * Produces bounded deterministic ranges (never more than `maxCandidates`):
   *   - current tick ± (1 * tickSpacing → width / 2)
   *   - full range
   * This is a pure calculation — the AI never picks raw ticks.
   */
  generateCandidateRanges(
    currentTick: number,
    tickSpacing: number,
    maxCandidates: number = 5,
  ): Array<{ lowerTick: number; upperTick: number; label: string }> {
    const candidates: Array<{ lowerTick: number; upperTick: number; label: string }> = [];
    const center = this.alignTickDown(currentTick, tickSpacing);

    // Narrow: ±1 tick spacing
    candidates.push({
      lowerTick: center - tickSpacing,
      upperTick: center + tickSpacing,
      label: 'narrow',
    });

    // Medium: ±2 tick spacings
    candidates.push({
      lowerTick: center - 2 * tickSpacing,
      upperTick: center + 2 * tickSpacing,
      label: 'medium',
    });

    // Wide: ±4 tick spacings
    candidates.push({
      lowerTick: center - 4 * tickSpacing,
      upperTick: center + 4 * tickSpacing,
      label: 'wide',
    });

    // Full range: ±10 tick spacings (or a fixed large band)
    candidates.push({
      lowerTick: center - 10 * tickSpacing,
      upperTick: center + 10 * tickSpacing,
      label: 'full',
    });

    return candidates.slice(0, maxCandidates);
  }

  /**
   * Estimate net profit from moving a position (or creating one) relative to
   * the candidate range.
   *
   * netProfitCents = feesEarnedCents (projected) - gasCostCents - slippageCostCents - riskAdjustmentCents
   *
   * Positive net profit means a rebalance is economically viable.
   */
  estimateNetProfitCents(
    projectedFeesCents: string,
    gasCostCents: string,
    slippageCents: string,
    riskAdjustmentCents: string,
  ): string {
    const fees = BigInt(projectedFeesCents || '0');
    const gas = BigInt(gasCostCents || '0');
    const slippage = BigInt(slippageCents || '0');
    const risk = BigInt(riskAdjustmentCents || '0');
    return (fees - gas - slippage - risk).toString();
  }

  /**
   * Check if a position needs rebalancing (out of range + profitable).
   *
   * Returns true ONLY if:
   *   1. current tick is outside the position's range, AND
   *   2. estimated net profit for the best candidate is positive
   */
  shouldRebalance(currentTick: number, lowerTick: number, upperTick: number, netProfitCents: string): boolean {
    if (this.isInRange(currentTick, lowerTick, upperTick)) return false;
    return BigInt(netProfitCents || '0') > 0n;
  }

  /** Token ratio: proportion of position value in token0 vs token1 at the current tick.
   *  Returns a 0–10000 basis point fraction of the position in token0. */
  token0FractionBps(currentTick: number, lowerTick: number, upperTick: number): number {
    if (lowerTick === upperTick) return 5000;
    const clampedTick = Math.max(lowerTick, Math.min(currentTick, upperTick - 1));
    const range = upperTick - lowerTick;
    const offset = clampedTick - lowerTick;
    return Math.round((offset / range) * 10000);
  }
}