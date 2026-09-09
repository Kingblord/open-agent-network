/**
 * M11 — LpCandidateSelector.
 *
 * Deterministic filter → rank → bounded candidate set.
 *
 * The AI receives ONLY this bounded set — it never generates ticks/ranges.
 *
 * Steps:
 *   1. If position exists and is out of range → add REMOVE candidate (always valid).
 *   2. For each candidate range from LpRangeCalculator:
 *      - No position → CREATE candidate
 *      - Position exists → REPOSITION candidate (move to new range)
 *   3. Skip range-based candidates with negative net profit (but keep REMOVE).
 *   4. Rank by net profit (desc), then rank asc.
 *   5. Return bounded top-N (includes REMOVE if present).
 *
 * Candidate types:
 *   - REMOVE: existing position is out of range → extract liquidity (always kept)
 *   - CREATE: no position exists → create one at a computed range
 *   - REPOSITION: existing position → move to a different (better) range
 */

import { LpRangeCalculator } from './lp-calculator.js';
import { LpRiskModel, type LpRiskAssessment } from './lp-risk-model.js';
import type { LpPoolState, LpPosition, LpRebalanceSignal } from './types.js';
import { BANError, ErrorCode } from '@ban/shared';

export interface LpCandidateSelectorDeps {
  calculator?: LpRangeCalculator;
  riskModel?: LpRiskModel;
  maxCandidates?: number;
}

export class LpCandidateSelector {
  private readonly calc: LpRangeCalculator;
  private readonly risk: LpRiskModel;
  private readonly maxCandidates: number;

  constructor(deps: LpCandidateSelectorDeps = {}) {
    this.calc = deps.calculator ?? new LpRangeCalculator();
    this.risk = deps.riskModel ?? new LpRiskModel();
    this.maxCandidates = deps.maxCandidates ?? 5;
  }

  /**
   * Select bounded rebalance candidates from a pool observation and optional
   * existing position. The AI MUST only receive this bounded set.
   */
  select(pool: LpPoolState, position: LpPosition | null): LpRebalanceSignal[] {
    const candidates: LpRebalanceSignal[] = [];
    const tickSpacing = this.inferTickSpacing(pool.feeBps);

    // 1. Always add REMOVE candidate if position exists and is out of range
    if (position !== null && !this.calc.isInRange(pool.tick, position.lowerTick, position.upperTick)) {
      candidates.push(this.buildRemoveCandidate(pool, position));
    }

    // 2. Generate range-based candidates (CREATE if no position, REPOSITION if one exists)
    const ranges = this.calc.generateCandidateRanges(pool.tick, tickSpacing, this.maxCandidates);
    for (const range of ranges) {
      const action = position === null ? 'CREATE' : 'REPOSITION';
      const width = range.upperTick - range.lowerTick;
      // Volume is null when the live adapter could not produce a real 24h
      // volume (never a fabricated '0'). Unknown volume means fees CANNOT be
      // projected — the candidate is still surfaced (never starved on
      // uncertainty) with honest zero-fee + unknownVolume flag so the AI
      // decides with full information.
      const volumeKnown = pool.volumeUsdCents !== null && pool.volumeUsdCents !== undefined;
      const volumeCents = volumeKnown ? (pool.volumeUsdCents as string) : '0';
      const volumeAvailable = volumeKnown && BigInt(volumeCents) > 0n;
      const unknownVolume = !volumeKnown;
      const riskFactors = {
        volumeUsdCents: volumeCents,
        rangeWidthTicks: width,
        feeBps: pool.feeBps,
        volumeAvailable,
      };
      const riskAssess: LpRiskAssessment = this.risk.assess(riskFactors);
      const projectedFees = unknownVolume ? '0' : this.estimateProjectedFees(pool, position, range, width);
      // Live gas is part of the pool snapshot. Missing gas makes a range
      // candidate ineligible; REMOVE remains available as a safety action.
      if (pool.gasEstimateAvailable === false) continue;
      // Legacy hermetic fixtures omit gas metadata; live snapshots always set
      // it explicitly through LpDataProvider.
      const gasCents = pool.gasEstimateUsdCents ?? '50000';
      const slippageCents = this.estimateSlippageCents(range, width);
      const netProfit = this.calc.estimateNetProfitCents(
        projectedFees,
        gasCents,
        slippageCents,
        riskAssess.adjustmentCents,
      );

      // Skip range candidate ONLY when volume is KNOWN and it is unprofitable
      // (REMOVE is always kept). Unknown volume keeps the candidate visible —
      // starving on uncertainty would hide the opportunity from the AI.
      if (volumeKnown && BigInt(netProfit) < 0n) continue;

      candidates.push({
        action,
        poolAddress: pool.poolAddress,
        token0: pool.token0,
        token1: pool.token1,
        positionId: position?.positionId ?? '',
        lowerTick: range.lowerTick,
        upperTick: range.upperTick,
        reason: unknownVolume
          ? `Volume unknown (no 24h feed) — fees not projected; gas/slippage costs are on-chain real.`
          : this.buildReason(action, range.label, riskAssess),
        feesUsd: projectedFees,
        estimatedGasUsd: gasCents,
        estimatedSlippageUsd: slippageCents,
        netProfitUsd: netProfit,
        riskLevel: riskAssess.level,
        rank: 0,
        unknownVolume,
      });
    }

    // 3. Sort: REMOVE first (safety action), then by net profit desc
    candidates.sort((a, b) => {
      if (a.action === 'REMOVE' && b.action !== 'REMOVE') return -1;
      if (b.action === 'REMOVE' && a.action !== 'REMOVE') return 1;
      const profitDiff = Number(BigInt(b.netProfitUsd) - BigInt(a.netProfitUsd));
      if (profitDiff !== 0) return profitDiff;
      return a.rank - b.rank;
    });

    // 4. Re-rank after sorting and bound
    return candidates.map((c, i) => ({ ...c, rank: i + 1 })).slice(0, this.maxCandidates);
  }

  private buildRemoveCandidate(pool: LpPoolState, position: LpPosition): LpRebalanceSignal {
    const volumeKnown = pool.volumeUsdCents !== null && pool.volumeUsdCents !== undefined;
    const riskFactors = {
      volumeUsdCents: volumeKnown ? (pool.volumeUsdCents as string) : '0',
      rangeWidthTicks: Math.abs(position.upperTick - position.lowerTick),
      feeBps: pool.feeBps,
      volumeAvailable: volumeKnown && BigInt(pool.volumeUsdCents as string) > 0n,
    };
    const riskAssess: LpRiskAssessment = this.risk.assess(riskFactors);
    return {
      action: 'REMOVE',
      poolAddress: pool.poolAddress,
      token0: pool.token0,
      token1: pool.token1,
      positionId: position.positionId,
      lowerTick: position.lowerTick,
      upperTick: position.upperTick,
      reason: 'Position out of range — extract liquidity',
      feesUsd: '0',
      estimatedGasUsd: pool.gasEstimateAvailable && pool.gasEstimateUsdCents !== undefined
        ? pool.gasEstimateUsdCents
        : '0',
      estimatedSlippageUsd: '0',
      netProfitUsd: '0',
      riskLevel: riskAssess.level,
      rank: 0,
    };
  }

  private inferTickSpacing(feeBps: number): number {
    if (feeBps <= 100) return 1;
    if (feeBps <= 500) return 10;
    if (feeBps <= 3000) return 60;
    return 200;
  }

  private estimateProjectedFees(pool: LpPoolState, position: LpPosition | null, range: { label: string }, width: number): string {
    const feeBps = BigInt(pool.feeBps);
    const volume = BigInt(pool.volumeUsdCents || '0');
    const liquidity = pool.liquidity;
    const posLiquidity = position?.liquidity ?? liquidity;
    const rangeFactor = BigInt(Math.max(width, 1));
    if (BigInt(liquidity) <= 0n) return '0';
    const projected = (feeBps * volume * BigInt(posLiquidity)) / (rangeFactor * BigInt(liquidity) * 10000n);
    return projected.toString();
  }

  private estimateSlippageCents(range: { label: string }, width: number): string {
    const base = '1000';
    const factor = BigInt(Math.max(width, 1));
    return (BigInt(base) / factor).toString() || '1';
  }

  private buildReason(action: string, label: string, risk: LpRiskAssessment): string {
    return `${action} ${label} range | ${risk.reason}`;
  }
}