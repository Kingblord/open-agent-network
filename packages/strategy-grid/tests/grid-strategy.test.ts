/**
 * M12 — Grid Trading Agent: hermetic tests.
 *
 * Covers all M12 requirements:
 * 1. Grid level generation (deterministic, integer, bounds)
 * 2. Crossing detection (UP, DOWN, no-cross, exact boundary)
 * 3. Order size computation (constrained by exposure/cap)
 * 4. Candidate selection (bounded, ranked, STOP candidate)
 * 5. Risk model (fail-closed on unavailable data)
 * 6. ObservationBuilder (structured facts only, no raw payload)
 * 7. Strategy end-to-end (DevBrain→ActionProposal, ACT/PASS, fail-closed)
 * 8. No PolicyEngine/ExecutionEngine invocation
 * 9. Maximum capital/order/exposure limits
 * 10. Deterministic repeatability
 */

import { describe, it, expect } from 'vitest';
import { GridCalculator } from '../src/grid-calculator.js';
import { GridRiskModel } from '../src/grid-risk-model.js';
import { GridCandidateSelector } from '../src/grid-candidate-selector.js';
import { GridObservationBuilder } from '../src/observation-builder.js';
import type { GridState, GridConfig, GridFill } from '../src/types.js';
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError } from '@ban/shared';

// =============================================================================
// 1. Grid level generation
// =============================================================================

describe('GridCalculator — level generation', () => {
  const calc = new GridCalculator();

  it('generates correct number of levels', () => {
    const levels = calc.generateLevels(50000, 60000, 5, 100000, 50000);
    expect(levels.length).toBe(5);
  });

  it('produces equally spaced integer-cents prices', () => {
    const levels = calc.generateLevels(50000, 60000, 5, 100000, 50000);
    // spacing = (60000 - 50000) / (5 - 1) = 2500
    expect(levels[0].priceCents).toBe(50000);
    expect(levels[1].priceCents).toBe(52500);
    expect(levels[2].priceCents).toBe(55000);
    expect(levels[3].priceCents).toBe(57500);
    expect(levels[4].priceCents).toBe(60000);
  });

  it('assigns BUY/SELL sides correctly', () => {
    const levels = calc.generateLevels(50000, 60000, 5, 100000, 50000);
    // index 0,1 = BUY (lower half)
    expect(levels[0].side).toBe('BUY');
    expect(levels[1].side).toBe('BUY');
    // index 2 = median → BUY (conservative)
    expect(levels[2].side).toBe('BUY');
    // index 3,4 = SELL (upper half)
    expect(levels[3].side).toBe('SELL');
    expect(levels[4].side).toBe('SELL');
  });

  it('rejects invalid gridCount', () => {
    expect(() => calc.generateLevels(0, 100, 1, 1000, 500)).toThrow('gridCount must be >= 2');
  });

  it('rejects inverted bounds', () => {
    expect(() => calc.generateLevels(60000, 50000, 5, 100000, 50000)).toThrow('lowerPriceCents must be < upperPriceCents');
  });
});

// =============================================================================
// 2. Crossing detection
// =============================================================================

describe('GridCalculator — crossing detection', () => {
  const calc = new GridCalculator();

  function makeLevels() {
    return [
      { index: 0, priceCents: 10000, side: 'BUY' as const },
      { index: 1, priceCents: 11000, side: 'BUY' as const },
      { index: 2, priceCents: 12000, side: 'SELL' as const },
    ];
  }

  it('detects UP crossing through a level', () => {
    const crossing = calc.detectCrossing(makeLevels(), 10500, 11500);
    expect(crossing).not.toBeNull();
    expect(crossing!.direction).toBe('UP');
    expect(crossing!.level.index).toBe(1); // crossed 11000 (price went 10500 → 11500)
  });

  it('detects DOWN crossing through a level', () => {
    const crossing = calc.detectCrossing(makeLevels(), 11500, 10500);
    expect(crossing).not.toBeNull();
    expect(crossing!.direction).toBe('DOWN');
    expect(crossing!.level.index).toBe(1); // crossed 11000 (price went 11500 → 10500)
  });

  it('returns null when price does not cross a level', () => {
    const crossing = calc.detectCrossing(makeLevels(), 10100, 10400);
    expect(crossing).toBeNull();
  });

  it('returns null when price did not move', () => {
    const crossing = calc.detectCrossing(makeLevels(), 10500, 10500);
    expect(crossing).toBeNull();
  });

  it('detects crossing at exact price match', () => {
    const crossing = calc.detectCrossing(makeLevels(), 10500, 11000);
    expect(crossing).not.toBeNull();
    expect(crossing!.level.index).toBe(1);
  });
});

// =============================================================================
// 3. Order size constraints
// =============================================================================

describe('GridCalculator — order size computation', () => {
  const calc = new GridCalculator();
  const config: GridConfig = {
    lowerPriceCents: 50000,
    upperPriceCents: 60000,
    gridCount: 5,
    capitalCents: 100000,
    maxOrderSizeCents: 50000,
    maxActiveExposureCents: 100000,
    expiresAt: '2099-01-01',
  };

  const upCrossing = { direction: 'UP' as const, level: { index: 3, priceCents: 57500, side: 'SELL' as const }, previousPriceCents: 55000, currentPriceCents: 60000, actionable: true };
  const downCrossing = { direction: 'DOWN' as const, level: { index: 1, priceCents: 52500, side: 'BUY' as const }, previousPriceCents: 55000, currentPriceCents: 50000, actionable: true };

  it('SELL order is limited by active exposure', () => {
    const size = calc.computeOrderSizeCents(upCrossing, 10000, config);
    expect(size).toBe(10000); // exposure=10000, max=50000 → min = 10000
  });

  it('BUY order is limited by remaining capital', () => {
    const size = calc.computeOrderSizeCents(downCrossing, 30000, config);
    // remaining = 100000 - 30000 = 70000, maxOrder = 50000 → min = 50000
    expect(size).toBe(50000);
  });

  it('BUY order returns 0 when capital exhausted', () => {
    const size = calc.computeOrderSizeCents(downCrossing, 100000, config);
    // remaining = 0
    expect(size).toBe(0);
  });
});

// =============================================================================
// 4. Candidate selection (bounded, ranked, STOP)
// =============================================================================

describe('GridCandidateSelector — deterministic selection', () => {
  const selector = new GridCandidateSelector();

  function makeState(overrides: Partial<GridState> = {}): GridState {
    const levels = [
      { index: 0, priceCents: 50000, side: 'BUY' as const },
      { index: 1, priceCents: 52500, side: 'BUY' as const },
      { index: 2, priceCents: 55000, side: 'BUY' as const },
      { index: 3, priceCents: 57500, side: 'SELL' as const },
      { index: 4, priceCents: 60000, side: 'SELL' as const },
    ];
    return {
      config: {
        lowerPriceCents: 50000,
        upperPriceCents: 60000,
        gridCount: 5,
        capitalCents: 100000,
        maxOrderSizeCents: 50000,
        maxActiveExposureCents: 100000,
        stopOnLowerBoundBreak: true,
        stopOnUpperBoundBreak: true,
        expiresAt: '2099-01-01',
      },
      levels,
      fills: [],
      activeExposureCents: 20000,
      realizedPnlCents: 1000,
      stopped: false,
      lastPriceCents: 52000,
      ...overrides,
    };
  }

  it('returns empty when no crossing occurs', () => {
    const state = makeState({ lastPriceCents: 52000 });
    // Use a price that doesn't land exactly on a level boundary
    const candidates = selector.select(52300, state);
    expect(candidates.length).toBe(0);
  });

  it('returns a BUY candidate on DOWN crossing', () => {
    const state = makeState({ lastPriceCents: 53000 });
    const candidates = selector.select(50000, state);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].action).toBe('BUY');
  });

  it('returns a SELL candidate on UP crossing', () => {
    const state = makeState({ lastPriceCents: 52000 });
    const candidates = selector.select(60000, state);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].action).toBe('SELL');
  });

  it('STOP candidate included when price exceeds bounds', () => {
    const state = makeState({ lastPriceCents: 55000 });
    const candidates = selector.select(62000, state);
    const stop = candidates.find((c) => c.action === 'STOP');
    expect(stop).toBeDefined();
    expect(stop!.riskLevel).toBe('HIGH');
  });

  it('returns empty candidates when grid is stopped', () => {
    const state = makeState({ stopped: true });
    const candidates = selector.select(50000, state);
    expect(candidates.length).toBe(0);
  });

  it('bounded to topN', () => {
    const state = makeState({ lastPriceCents: 55000 });
    const candidates = selector.select(50000, state, 1);
    expect(candidates.length).toBeLessThanOrEqual(1);
  });

  it('deterministic across runs', () => {
    const state = makeState({ lastPriceCents: 55000 });
    const c1 = selector.select(50000, state);
    const c2 = selector.select(50000, state);
    expect(c1.map((c) => c.action)).toEqual(c2.map((c) => c.action));
  });
});

// =============================================================================
// 5. Risk model — fail-closed
// =============================================================================

describe('GridRiskModel — fail-closed behavior', () => {
  const risk = new GridRiskModel();

  it('returns HIGH when volatility data unavailable', () => {
    const result = risk.assess({
      exposureRatioBps: 5000,
      volatilityBps: 0,
      volatilityAvailable: false,
      distanceToStopCents: 5000,
    });
    expect(result.level).toBe('HIGH');
  });

  it('returns LOW for safe conditions', () => {
    const result = risk.assess({
      exposureRatioBps: 1000,
      volatilityBps: 100,
      volatilityAvailable: true,
      distanceToStopCents: 5000,
    });
    expect(result.level).toBe('LOW');
  });

  it('returns HIGH for high exposure + high volatility', () => {
    const result = risk.assess({
      exposureRatioBps: 9000,
      volatilityBps: 600,
      volatilityAvailable: true,
      distanceToStopCents: 5000,
    });
    expect(result.level).toBe('HIGH');
  });

  it('returns MEDIUM for moderate exposure', () => {
    const result = risk.assess({
      exposureRatioBps: 6000,
      volatilityBps: 100,
      volatilityAvailable: true,
      distanceToStopCents: 5000,
    });
    expect(result.level).toBe('MEDIUM');
  });
});

// =============================================================================
// 6. Observation builder
// =============================================================================

describe('GridObservationBuilder — structured facts only', () => {
  const builder = new GridObservationBuilder('grid-trading');
  const agent = {
    id: 'agent_1',
    name: 'GridBot',
    description: 'test',
    type: 'grid',
    ownerId: 'user_1',
    walletAddress: '0xabc',
    status: 'ACTIVE' as const,
    capabilities: [{ id: 'PROPOSE_GRID_ORDER', name: 'Grid Trading' }],
    protocols: [],
    riskLevel: 'LOW' as const,
  };

  const config: GridConfig = {
    lowerPriceCents: 50000,
    upperPriceCents: 60000,
    gridCount: 5,
    capitalCents: 100000,
    maxOrderSizeCents: 50000,
    maxActiveExposureCents: 100000,
    expiresAt: '2099-01-01',
  };

  const levels = [
    { index: 0, priceCents: 50000, side: 'BUY' as const },
    { index: 1, priceCents: 52500, side: 'BUY' as const },
    { index: 2, priceCents: 55000, side: 'BUY' as const },
    { index: 3, priceCents: 57500, side: 'SELL' as const },
    { index: 4, priceCents: 60000, side: 'SELL' as const },
  ];

  const crossing = {
    direction: 'DOWN' as const,
    level: { index: 1, priceCents: 52500, side: 'BUY' as const },
    previousPriceCents: 55000,
    currentPriceCents: 52000,
    actionable: true,
  };

  const candidates = [{
    action: 'BUY' as const,
    level: { index: 1, priceCents: 52500, side: 'BUY' as const },
    maxSizeCents: 50000,
    estimatedProfitCents: 50,
    estimatedGasCents: 10,
    netBenefitCents: 40,
    reason: 'Price crossed DOWN through level 1',
    riskLevel: 'LOW' as const,
    rank: 1,
  }];

  const fills: GridFill[] = [];

  it('produces a structured observation (no raw adapter payload)', () => {
    const obs = builder.build(agent as never, config, levels, crossing, candidates, fills, 52000, '$520.00');
    expect((obs as any).type).toBe('grid_trading');
    expect((obs as any).data.currentPrice.cents).toBe(52000);
     expect((obs as any).data.currentPrice.display).toBe('$520.00 USD');
  });

  it('exposes candidate facts only — not execution params', () => {
    const obs = builder.build(agent as never, config, levels, crossing, candidates, fills, 52000, '$520.00');
    const c = (obs as any).data.candidates[0];
    expect(c.action).toBe('BUY');
    expect(c.levelIndex).toBe(1);
    expect(c.priceCents).toBe(52500);
    expect(c.rawPoolData).toBeUndefined();
    expect(c.liquidity).toBeUndefined();
  });

  it('crossing is null when no crossing occurred', () => {
    const obs = builder.build(agent as never, config, levels, null, [], fills, 53000, '$530.00');
    expect((obs as any).data.crossing).toBeNull();
  });

  it('contains filled level info', () => {
    const fillsWithData: GridFill[] = [{
      levelIndex: 0, side: 'BUY', filledAt: new Date().toISOString(), priceCents: 50000, sizeCents: 25000,
    }];
    const obs = builder.build(agent as never, config, levels, crossing, candidates, fillsWithData, 52000, '$520.00');
    expect((obs as any).data.filledLevels.length).toBe(1);
    const f = (obs as any).data.filledLevels[0];
    expect(f.levelIndex).toBe(0);
    expect(f.side).toBe('BUY');
  });
});

// =============================================================================
// 7. STOP logic
// =============================================================================

describe('GridCalculator — stop conditions', () => {
  const calc = new GridCalculator();

  const config: GridConfig = {
    lowerPriceCents: 50000,
    upperPriceCents: 60000,
    gridCount: 5,
    capitalCents: 100000,
    maxOrderSizeCents: 50000,
    maxActiveExposureCents: 100000,
    stopOnLowerBoundBreak: true,
    stopOnUpperBoundBreak: true,
    expiresAt: '2099-01-01',
  };

  it('triggers stop when price goes below lower bound', () => {
    expect(calc.shouldStop(49999, config)).toBe(true);
  });

  it('triggers stop when price goes above upper bound', () => {
    expect(calc.shouldStop(60001, config)).toBe(true);
  });

  it('does not trigger stop when price is within bounds', () => {
    expect(calc.shouldStop(55000, config)).toBe(false);
  });

  it('does not trigger stop when stop is not configured', () => {
    const configNoStop: GridConfig = { ...config, stopOnLowerBoundBreak: false, stopOnUpperBoundBreak: false };
    expect(calc.shouldStop(49999, configNoStop)).toBe(false);
  });
});

// =============================================================================
// 8. Strategy end-to-end (hermetic, in-memory brain)
// =============================================================================

describe('GridStrategy end-to-end', () => {
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
        strategyId: 'grid-trading',
        status: 'ACT' as const,
        createdAt: now,
        reasoning: 'grid crossing detected, executing BUY',
        proposal: {
          proposalId: `prop_${this.counter}`,
          agentId: 'agent_1',
          userId: 'user_1',
          strategyId: 'grid-trading',
          sessionId: 'sess_1',
          protocol: 'pancake',
          contract: '0xswap',
          function: 'swap',
          action: 'SWAP' as const,
          capabilityId: 'PROPOSE_GRID_ORDER',
          token: 'BNB',
          amount: '2500000000000000000',
          estimatedValue: '2500000000000000000',
          asset: 'BNB',
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
    name: 'GridBot',
    description: 'test',
    type: 'grid',
    ownerId: 'user_1',
    walletAddress: '0xabc',
    status: 'ACTIVE' as const,
    capabilities: [{ id: 'PROPOSE_GRID_ORDER', name: 'Grid Trading' }],
    protocols: [],
    riskLevel: 'LOW' as const,
  };

  it('observe() returns a structured observation, not raw data', async () => {
    const { GridStrategy } = await import('../src/grid-strategy.js');
    const { GridDataProvider } = await import('../src/grid-data-provider.js');

    const brain = new RecordingBrain();
    const data = new GridDataProvider({
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '550.00', timestamp: new Date().toISOString() };
        },
      },
    });
    const strat = new GridStrategy({ brain: brain as never, data, strategyId: 'grid-trading' });
    const obs = await strat.observe(agent as never, 'corr_1');
    expect(obs.length).toBe(1);
    expect((obs[0] as any).type).toBe('grid_trading');
  });

  it('recenters an out-of-range price instead of becoming a permanent no-op', async () => {
    const { GridStrategy } = await import('../src/grid-strategy.js');
    const { GridDataProvider } = await import('../src/grid-data-provider.js');

    const data = new GridDataProvider({
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '747.68', timestamp: new Date().toISOString() };
        },
      },
    });
    const strat = new GridStrategy({
      brain: new RecordingBrain() as never,
      data,
      config: {
        lowerPriceCents: 50000,
        upperPriceCents: 60000,
        gridCount: 5,
        capitalCents: 100000,
        maxOrderSizeCents: 50000,
      },
    });

    const [observation] = await strat.observe(agent as never, 'corr_recenter');
    const state = strat.getState()!;
    const gridData = (observation as any).data;

    expect(gridData.rangeStatus).toBe('RECENTERED_AROUND_LIVE_PRICE');
    expect(state.config.lowerPriceCents).toBeLessThan(74768);
    expect(state.config.upperPriceCents).toBeGreaterThan(74768);
    expect(state.config.upperPriceCents - state.config.lowerPriceCents).toBe(10000);
    expect(state.lastPriceCents).toBe(74768);
  });

  it('decide() returns a schema-valid canonical ActionProposal when a grid signal exists', async () => {
    const { GridStrategy } = await import('../src/grid-strategy.js');
    const { GridDataProvider } = await import('../src/grid-data-provider.js');

    const brain = new RecordingBrain();
    const data = new GridDataProvider({
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '550.00', timestamp: new Date().toISOString() };
        },
      },
    });
    const strat = new GridStrategy({ brain: brain as never, data });
    // Prime the grid, then force a DOWN crossing through level 3 ($550) on the
    // next observation so the observation carries a real BUY candidate (a fresh
    // grid holds no inventory, so an UP/SELL crossing has zero order size).
    const obs0 = await strat.observe(agent as never, 'corr_1');
    expect(obs0.length).toBe(1);
    const state = strat.getState()!;
    strat.setState({ ...state, lastPriceCents: 56000 });
    const obs = await strat.observe(agent as never, 'corr_1');
    const obsData = (obs[0] as unknown as { data: { candidates: Array<{ action: string }> } }).data;
    expect(obsData.candidates.length).toBeGreaterThan(0);

    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    const parsedOk = ActionProposalSchema.safeParse(proposal);
    expect(parsedOk.success).toBe(true);
    // Canonical fields are strategy-authored — never the brain's mock values.
    expect(proposal!.action).toBe('SWAP');
    expect(proposal!.protocol).toBe('pancakeswap');
    expect(proposal!.function).toBe('exactInputSingle');
    expect(proposal!.amount).toMatch(/^\d+$/);
    expect(proposal!.estimatedValue).toMatch(/^\d+$/);
    expect((proposal!.params as Record<string, unknown>).execKind).toBe('PANCAKE_V3_SWAP');
    expect(['BUY', 'SELL']).toContain((proposal!.params as Record<string, unknown>).side);
  });

  it('returns null when the brain ACTs but the observation carries no grid signal (honest no-op)', async () => {
    const { GridStrategy } = await import('../src/grid-strategy.js');
    const { GridDataProvider } = await import('../src/grid-data-provider.js');

    const brain = new RecordingBrain();
    const data = new GridDataProvider({
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '550.00', timestamp: new Date().toISOString() };
        },
      },
    });
    const strat = new GridStrategy({ brain: brain as never, data });
    // First observation: no crossing (price at the grid midpoint) → no
    // candidates. Even though the brain ACTs, decide() must honestly no-op.
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).toBeNull();
  });

  it('returns null when the brain decides PASS', async () => {
    const { GridStrategy } = await import('../src/grid-strategy.js');
    const { GridDataProvider } = await import('../src/grid-data-provider.js');

    const passBrain = {
      async decide() {
        return {
          decisionId: 'dec_p',
          agentId: 'agent_1',
          strategyId: 'grid-trading',
          status: 'PASS' as const,
          createdAt: new Date().toISOString(),
        };
      },
    };
    const data = new GridDataProvider({
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '550.00', timestamp: new Date().toISOString() };
        },
      },
    });
    const strat = new GridStrategy({ brain: passBrain as never, data });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).toBeNull();
  });

  it('fails closed on malformed brain output', async () => {
    const { GridStrategy } = await import('../src/grid-strategy.js');
    const { GridDataProvider } = await import('../src/grid-data-provider.js');

    const wrongBrain = { async decide() { return 'garbage'; } };
    const data = new GridDataProvider({
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '550.00', timestamp: new Date().toISOString() };
        },
      },
    });
    const strat = new GridStrategy({ brain: wrongBrain as never, data });
    const obs = await strat.observe(agent as never, 'corr_1');
    await expect(strat.decide(obs[0], agent as never)).rejects.toThrow(BANError);
  });

  it('does NOT invoke PolicyEngine or ExecutionEngine — only the injected brain', async () => {
    const { GridStrategy } = await import('../src/grid-strategy.js');
    const { GridDataProvider } = await import('../src/grid-data-provider.js');

    const brain = new RecordingBrain();
    const data = new GridDataProvider({
      price: {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '550.00', timestamp: new Date().toISOString() };
        },
      },
    });
    const strat = new GridStrategy({ brain: brain as never, data });
    // Force a DOWN crossing (56000 → 55000) so the observation carries a
    // tradeable BUY candidate (fresh grid has no inventory for SELL sizing).
    await strat.observe(agent as never, 'corr_1');
    const state = strat.getState()!;
    strat.setState({ ...state, lastPriceCents: 56000 });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    expect(brain.calls.length).toBe(1); // decide() is the only brain touchpoint
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });
});

// =============================================================================
// 9. Maximum capital/order/exposure limits
// =============================================================================

describe('Grid limits — capital, order, exposure', () => {
  const calc = new GridCalculator();

  const config: GridConfig = {
    lowerPriceCents: 50000,
    upperPriceCents: 60000,
    gridCount: 5,
    capitalCents: 100000,
    maxOrderSizeCents: 50000,
    maxActiveExposureCents: 75000,
    expiresAt: '2099-01-01',
  };

  const downCrossing = { direction: 'DOWN' as const, level: { index: 1, priceCents: 52500, side: 'BUY' as const }, previousPriceCents: 55000, currentPriceCents: 52000, actionable: true };

  it('order size does not exceed maxOrderSize', () => {
    const size = calc.computeOrderSizeCents(downCrossing, 10000, config);
    expect(size).toBeLessThanOrEqual(config.maxOrderSizeCents);
  });

  it('order size does not exceed remaining capital', () => {
    const size = calc.computeOrderSizeCents(downCrossing, 80000, config);
    // remaining = 100000 - 80000 = 20000, maxOrder = 50000 → min = 20000
    expect(size).toBeLessThanOrEqual(100000 - 80000);
  });

  it('SELL order limited by current exposure', () => {
    const upCrossing = { direction: 'UP' as const, level: { index: 3, priceCents: 57500, side: 'SELL' as const }, previousPriceCents: 55000, currentPriceCents: 58000, actionable: true };
    const size = calc.computeOrderSizeCents(upCrossing, 30000, config);
    expect(size).toBe(30000);
  });
});

// =============================================================================
// 10. Deterministic repeatability
// =============================================================================

describe('Deterministic repeatability', () => {
  const calc = new GridCalculator();

  it('same inputs produce same levels', () => {
    const a = calc.generateLevels(50000, 60000, 5, 100000, 50000);
    const b = calc.generateLevels(50000, 60000, 5, 100000, 50000);
    expect(a).toEqual(b);
  });

  it('same crossing detection is deterministic', () => {
    const levels = [
      { index: 0, priceCents: 10000, side: 'BUY' as const },
      { index: 1, priceCents: 11000, side: 'BUY' as const },
      { index: 2, priceCents: 12000, side: 'SELL' as const },
    ];
    const a = calc.detectCrossing(levels, 10500, 11500);
    const b = calc.detectCrossing(levels, 10500, 11500);
    expect(a).toEqual(b);
  });
});