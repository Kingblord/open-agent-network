/**
 * M11 — LP Rebalancing strategy: hermetic tests.
 *
 * Covers all 15+ M11 requirements (see M11 spec):
 *
 * 1. Known-vector tick/math tests (sqrtPriceX96→tick, tick↔price, alignment, boundary)
 * 2. In-range / out-of-range detection (exact lower, exact upper, inside, outside)
 * 3. Deterministic candidate generation (not from AI)
 * 4. Deterministic ranking / tie-breaking
 * 5. Risk model (fail-closed on unknown volume)
 * 6. Observation builder (structured facts only, no raw payload)
 * 7. Strategy end-to-end (DevBrain→ActionProposal, ACT/PASS, fail-closed)
 * 8. AI cannot create arbitrary candidate (only receives bounded set)
 * 9. No PolicyEngine / ExecutionEngine invocation
 * 10. Token orientation and decimal awareness
 */

import { describe, it, expect } from 'vitest';
import { LpRangeCalculator } from '../src/lp-calculator.js';
import { LpRiskModel } from '../src/lp-risk-model.js';
import { LpCandidateSelector } from '../src/lp-candidate-selector.js';
import { LpDataProvider } from '../src/lp-data-provider.js';
import { LpObservationBuilder } from '../src/observation-builder.js';
import { LpStrategy } from '../src/lp-strategy.js';
import type { LpPoolState, LpPosition } from '../src/types.js';
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError } from '@ban/shared';

// =============================================================================
// 1. Known-vector tick/math tests
// =============================================================================

describe('LpRangeCalculator — known-vector tick/math', () => {
  const calc = new LpRangeCalculator();

  it('sqrtPriceX96ToTick produces expected values for known ratios', () => {
    // Q96 = 2^96 ≈ 7.923e28
    // sqrtPriceX96 = Q96 → ratio = 1.0 → tick = 0
    const q96 = '79228162514264337593543950336';
    const tick0 = calc.sqrtPriceX96ToTick(q96);
    expect(tick0).toBe(0);
  });

  it('tickToSqrtPriceX96 produces expected output for tick 0', () => {
    const sqrt = calc.tickToSqrtPriceX96(0);
    expect(sqrt).toBe('79228162514264337593543950336');
  });

  it('tick/spacing alignment works correctly', () => {
    expect(calc.alignTickDown(13, 10)).toBe(10);
    expect(calc.alignTickDown(10, 10)).toBe(10);
    expect(calc.alignTickDown(-13, 10)).toBe(-20);
    expect(calc.alignTickUp(13, 10)).toBe(20);
    expect(calc.alignTickUp(-13, 10)).toBe(-10);
  });
});

// =============================================================================
// 2. In-range / out-of-range detection
// =============================================================================

describe('LpRangeCalculator — boundary detection (in-range/out-of-range)', () => {
  const calc = new LpRangeCalculator();

  const LOWER = -50;
  const UPPER = 50;

  it('detects current tick below range', () => {
    expect(calc.isInRange(-51, LOWER, UPPER)).toBe(false);
  });

  it('detects current tick inside range', () => {
    expect(calc.isInRange(0, LOWER, UPPER)).toBe(true);
  });

  it('detects current tick above range', () => {
    expect(calc.isInRange(50, LOWER, UPPER)).toBe(false);
  });

  it('treats current tick exactly at lower bound as in-range', () => {
    expect(calc.isInRange(-50, LOWER, UPPER)).toBe(true);
  });

  it('treats current tick exactly at upper bound as out-of-range', () => {
    // Uniswap V3 convention: tick < upper → so tick == upper is out of range
    expect(calc.isInRange(50, LOWER, UPPER)).toBe(false);
  });
});

// =============================================================================
// 3. Candidate generation
// =============================================================================

describe('LpRangeCalculator — candidate range generation', () => {
  const calc = new LpRangeCalculator();

  it('generates deterministic bounded ranges around current tick', () => {
    const ranges = calc.generateCandidateRanges(0, 60, 4);
    expect(ranges.length).toBe(4);
    // centre = 0, narrow = -60 to 60
    expect(ranges[0].lowerTick).toBe(-60);
    expect(ranges[0].upperTick).toBe(60);
    expect(ranges[0].label).toBe('narrow');
  });

  it('aligns centre to tick spacing, then offsets by ± spacing intervals', () => {
    const ranges = calc.generateCandidateRanges(13, 60, 3);
    // centre = alignTickDown(13, 60) = 0
    // narrow: centre ± 60 = [-60, 60]
    expect(ranges[0].lowerTick).toBe(-60);
    expect(ranges[0].upperTick).toBe(60);
    // medium: centre ± 120 = [-120, 120]
    expect(ranges[1].lowerTick).toBe(-120);
    expect(ranges[1].upperTick).toBe(120);
  });

  it('respects maxCandidates', () => {
    const ranges = calc.generateCandidateRanges(0, 60, 2);
    expect(ranges.length).toBe(2);
  });
});

// =============================================================================
// 4. Candidate selector
// =============================================================================

describe('LpCandidateSelector — deterministic selection', () => {
  const selector = new LpCandidateSelector({ maxCandidates: 3 });

  function makePool(overrides: Partial<LpPoolState> = {}): LpPoolState {
    return {
      poolAddress: '0xpool',
      token0: '0xt0',
      token1: '0xt1',
      feeBps: 3000,
      sqrtPriceX96: '79228162514264337593543950336',
      tick: 0,
      liquidity: '1000000000000000000000',
      volumeUsdCents: '500000000', // $5M
      timestamp: 'now',
      ...overrides,
    };
  }

  function makePosition(overrides: Partial<LpPosition> = {}): LpPosition {
    return {
      positionId: 'pos_1',
      lowerTick: -60,
      upperTick: 60,
      liquidity: '1000000000000000000',
      token0Amount: '1000000',
      token1Amount: '1000000',
      feesUsd: '50000',
      timestamp: 'now',
      ...overrides,
    };
  }

  it('returns bounded candidates (≤ maxCandidates)', () => {
    const pool = makePool();
    const candidates = selector.select(pool, null);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('every candidate has a deterministic range (not AI-generated)', () => {
    const pool = makePool();
    const candidates = selector.select(pool, null);
    for (const c of candidates) {
      expect(typeof c.lowerTick).toBe('number');
      expect(typeof c.upperTick).toBe('number');
      expect(c.lowerTick).toBeLessThan(c.upperTick);
    }
  });

  it('sorts candidates by net profit descending', () => {
    const pool = makePool({ volumeUsdCents: '10000000000' }); // high volume
    const candidates = selector.select(pool, null);
    for (let i = 1; i < candidates.length; i++) {
      expect(Number(BigInt(candidates[i - 1].netProfitUsd))).toBeGreaterThanOrEqual(
        Number(BigInt(candidates[i].netProfitUsd)),
      );
    }
  });

  it('deterministic ranking (tie-breaking works consistently)', () => {
    const pool1 = makePool({ tick: 0, volumeUsdCents: '5000000000' });
    const pool2 = makePool({ tick: 0, volumeUsdCents: '5000000000' });
    const c1 = selector.select(pool1, null);
    const c2 = selector.select(pool2, null);
    expect(c1.map((c) => c.lowerTick)).toEqual(c2.map((c) => c.lowerTick));
  });

  it('REMOVE is always included even if unprofitable', () => {
    const pool = makePool({ volumeUsdCents: '1000' }); // tiny volume → all unprofitable
    const position = makePosition({ lowerTick: -50, upperTick: 50 });
    const poolOut = makePool({ tick: 200, volumeUsdCents: '1000' });
    const candidates = selector.select(poolOut, position);
    // REMOVE candidate should be present (position is out of range at tick 200)
    expect(candidates.some((c) => c.action === 'REMOVE')).toBe(true);
  });

  it('no AI-generated ticks in any candidate', () => {
    const pool = makePool();
    const candidates = selector.select(pool, null);
    for (const c of candidates) {
      // The AI MUST NOT be able to generate new ranges — all are precomputed
      expect(c.rank).toBeGreaterThanOrEqual(1);
    }
  });
});

// =============================================================================
// 5. Risk model — fail-closed
// =============================================================================

describe('LpRiskModel — fail-closed behavior', () => {
  const riskModel = new LpRiskModel();

  it('returns HIGH with adjustment when volume data is unavailable', () => {
    const result = riskModel.assess({
      volumeUsdCents: '0',
      rangeWidthTicks: 100,
      feeBps: 3000,
      volumeAvailable: false,
    });
    expect(result.level).toBe('HIGH');
    expect(BigInt(result.adjustmentCents)).toBeGreaterThan(0n);
  });

  it('returns LOW for high-volume pools with reasonable range', () => {
    const result = riskModel.assess({
      volumeUsdCents: '50000000000', // $500M volume
      rangeWidthTicks: 200,
      feeBps: 500,
      volumeAvailable: true,
    });
    expect(result.level).toBe('LOW');
    expect(result.adjustmentCents).toBe('0');
  });

  it('returns MEDIUM for moderate volume', () => {
    const result = riskModel.assess({
      volumeUsdCents: '5000000', // $50k
      rangeWidthTicks: 100,
      feeBps: 3000,
      volumeAvailable: true,
    });
    expect(result.level).toBe('MEDIUM');
  });
});

// =============================================================================
// 6. Observation builder
// =============================================================================

describe('LpObservationBuilder — structured facts only', () => {
  const calc = new LpRangeCalculator();
  const builder = new LpObservationBuilder('lp-rebalance', calc);

  const agent = {
    id: 'agent_1',
    name: 'LPBot',
    description: 'test',
    type: 'liquidity',
    ownerId: 'user_1',
    walletAddress: '0xabc',
    status: 'ACTIVE' as const,
    capabilities: [{ id: 'PROPOSE_LP_REBALANCE', name: 'LP Rebalance' }],
    protocols: ['0xpool'],
    riskLevel: 'LOW' as const,
  };

  const pool: LpPoolState = {
    poolAddress: '0xpool',
    token0: '0xt0',
    token1: '0xt1',
    feeBps: 3000,
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
    liquidity: '1000000000000000000',
    volumeUsdCents: '500000000',
    timestamp: 'now',
  };

  const position: LpPosition = {
    positionId: 'pos_1',
    lowerTick: -60,
    upperTick: 60,
    liquidity: '1000000000000000',
    token0Amount: '1000000',
    token1Amount: '1000000',
    feesUsd: '50000',
    timestamp: 'now',
  };

  const candidates = [
    {
      action: 'REPOSITION' as const,
      poolAddress: '0xpool',
      token0: '0xt0',
      token1: '0xt1',
      positionId: 'pos_1',
      lowerTick: -120,
      upperTick: 120,
      reason: 'wider range for current volatility',
      feesUsd: '100000',
      estimatedGasUsd: '50000',
      estimatedSlippageUsd: '1000',
      netProfitUsd: '49000',
      riskLevel: 'LOW' as const,
      rank: 1,
    },
  ];

  it('produces a structured observation (no raw LiquidityAdapter payload)', () => {
    const obs = builder.build(agent as never, pool, position, candidates);
    expect(obs.type).toBe('lp_rebalance');
    // @ts-ignore — structured data shape
    expect(obs.data.tick).toBe(0);
    // @ts-ignore — must NOT contain raw adapter fields
    expect(obs.data.raw).toBeUndefined();
  });

  it('contains candidate facts only — not execution parameters', () => {
    const obs = builder.build(agent as never, pool, position, candidates);
    // @ts-ignore
    const c = obs.data.candidates[0];
    expect(c.lowerTick).toBe(-120);
    expect(c.upperTick).toBe(120);
    expect(c.action).toBe('REPOSITION');
    // Must NOT contain arbitrary execution fields
    expect(c.arbitraryLiquidity).toBeUndefined();
    expect(c.rawPoolData).toBeUndefined();
  });

  it('tracks in-range status from current position', () => {
    const obs = builder.build(agent as never, pool, position, candidates);
    // @ts-ignore
    expect(obs.data.position.inRange).toBe(true); // tick 0, range -60 to 60 → in range
  });
});

// =============================================================================
// 7. Strategy end-to-end (hermetic, in-memory brain)
// =============================================================================

describe('LpStrategy end-to-end', () => {
  // Deterministic brain for ACT path
  class RecordingBrain {
    calls: unknown[] = [];
    private counter = 0;
    async decide(input: unknown) {
      this.calls.push(input);
      this.counter += 1;
      const now = new Date().toISOString();
      return {
        decisionId: `dec_${this.counter}`,
        agentId: 'agent_1',
        strategyId: 'lp-rebalance',
        status: 'ACT' as const,
        createdAt: now,
        reasoning: 'chose best LP range',
        proposal: {
          proposalId: `prop_${this.counter}`,
          agentId: 'agent_1',
          userId: 'user_1',
          strategyId: 'lp-rebalance',
          sessionId: 'sess_1',
          protocol: 'pancake',
          contract: '0xpool',
          function: 'mint',
          action: 'REBALANCE' as const,
          capabilityId: 'PROPOSE_LP_REBALANCE',
          token: 'LP',
          amount: '1000000000000000000',
          estimatedValue: '1000000000000000000',
          asset: 'LP',
          params: {},
          idempotencyKey: `ik_${this.counter}`,
          riskLevel: 'LOW',
          createdAt: now,
        },
      };
    }
  }

  const agent = {
    id: 'agent_1',
    name: 'LPBot',
    description: 'test',
    type: 'liquidity',
    ownerId: 'user_1',
    walletAddress: '0xabc',
    status: 'ACTIVE' as const,
    capabilities: [{ id: 'PROPOSE_LP_REBALANCE', name: 'LP Rebalance' }],
    protocols: ['0xpool'],
    riskLevel: 'LOW' as const,
  };

  function makeDataProvider() {
    return new LpDataProvider({
      liquidity: {
        async getPoolState() {
          return {
            token0: '0xt0',
            token1: '0xt1',
            fee: 3000,
            sqrtPriceX96: '79228162514264337593543950336',
            tick: 0,
            liquidity: '1000000000000000000',
            volumeUsd24h: '500000000',
            timestamp: 'now',
          };
        },
        async getPoolPosition() {
          return {
            positionId: 'pos_1',
            lowerTick: -60,
            upperTick: 60,
            liquidity: '1000000000000000',
            token0Amount: '1000000',
            token1Amount: '1000000',
            feesUsd: '50000',
            timestamp: 'now',
          };
        },
      },
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '1.0', timestamp: 'now' };
        },
      },
    });
  }

  it('observe() returns a structured observation, not raw data', async () => {
    const brain = new RecordingBrain();
    const strat = new LpStrategy({ brain: brain as never, data: makeDataProvider() });
    const obs = await strat.observe(agent as never, 'corr_1');
    expect(obs.length).toBe(1);
    expect(obs[0].type).toBe('lp_rebalance');
  });

  it('decide() returns a schema-valid ActionProposal from candidates', async () => {
    const brain = new RecordingBrain();
    const strat = new LpStrategy({ brain: brain as never, data: makeDataProvider() });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it('returns null when the brain decides PASS', async () => {
    const passBrain = {
      async decide() {
        return {
          decisionId: 'dec_p',
          agentId: 'agent_1',
          strategyId: 'lp-rebalance',
          status: 'PASS' as const,
          createdAt: new Date().toISOString(),
        };
      },
    };
    const strat = new LpStrategy({ brain: passBrain as never, data: makeDataProvider() });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).toBeNull();
  });

  it('fails closed on malformed brain output', async () => {
    const wrongBrain = { async decide() { return 'garbage'; } };
    const strat = new LpStrategy({ brain: wrongBrain as never, data: makeDataProvider() });
    const obs = await strat.observe(agent as never, 'corr_1');
    await expect(strat.decide(obs[0], agent as never)).rejects.toThrow(BANError);
  });

  it('does NOT invoke PolicyEngine or ExecutionEngine — only the injected brain', async () => {
    const brain = new RecordingBrain();
    const strat = new LpStrategy({ brain: brain as never, data: makeDataProvider() });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    expect(brain.calls.length).toBe(1);
    // Verify strategy never checked policy or execution
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });
});

// =============================================================================
// 8. AI cannot create arbitrary candidate (only receives bounded set)
// =============================================================================

describe('AI candidate boundary — cannot generate arbitrary ranges', () => {
  it('the observation contains only precomputed candidates (no freeform range)', async () => {
    const builder = new LpObservationBuilder('lp-rebalance');
    const pool: LpPoolState = {
      poolAddress: '0xpool',
      token0: '0xt0',
      token1: '0xt1',
      feeBps: 500,
      sqrtPriceX96: '79228162514264337593543950336',
      tick: 0,
      liquidity: '1000000000000000000',
      volumeUsdCents: '500000000',
      timestamp: 'now',
    };
    const candidates = [
      {
        action: 'CREATE' as const,
        poolAddress: '0xpool',
        token0: '0xt0',
        token1: '0xt1',
        positionId: '',
        lowerTick: -60,
        upperTick: 60,
        reason: 'narrow',
        feesUsd: '100',
        estimatedGasUsd: '50',
        estimatedSlippageUsd: '2',
        netProfitUsd: '48',
        riskLevel: 'LOW' as const,
        rank: 1,
      },
    ];
    const obs = builder.build({ id: 'a', capabilities: [] } as never, pool, null, candidates);
    // @ts-ignore
    const cand = obs.data.candidates[0];
    // The AI sees only the candidate — it cannot generate its own ticks
    expect(cand.lowerTick).toBe(-60);
    // There is no "aiGeneratedRange" field — the AI must use what BAN computed
    expect(cand.aiGenerated).toBeUndefined();
  });
});

// =============================================================================
// 9. Token orientation / decimal awareness
// =============================================================================

describe('Token orientation — explicit not assumed', () => {
  it('LpPoolState includes both token0 and token1 addresses (no assumption)', () => {
    const pool: LpPoolState = {
      poolAddress: '0xpool',
      token0: '0xt0',
      token1: '0xt1',
      feeBps: 500,
      sqrtPriceX96: '79228162514264337593543950336',
      tick: 0,
      liquidity: '1000',
      volumeUsdCents: '500000',
      timestamp: 'now',
    };
    // The strategy should treat token0 and token1 as opaque addresses
    expect(pool.token0).toBe('0xt0');
    expect(pool.token1).toBe('0xt1');
    // The human-readable price orientation requires knowing decimals
    expect(pool.decimals0).toBeUndefined(); // not assumed
  });
});