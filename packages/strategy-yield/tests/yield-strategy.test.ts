import { describe, it, expect } from 'vitest';
import {
  YieldDataProvider,
  YieldNormalizer,
  YieldRiskModel,
  YieldCandidateSelector,
  ObservationBuilder,
  YieldStrategy,
} from '../src/index.js';
import type { NormalizedOpportunity, YieldOpportunity } from '../src/types.js';
import { ActionProposalSchema } from '@ban/schemas';
import { BANError } from '@ban/shared';

// A minimal, deterministic fake of the @ban/blockchain YieldAdapter seam.
function fakeAdapter(opportunities: YieldOpportunity[]) {
  return {
    async getYieldOpportunities(_network: string): Promise<YieldOpportunity[]> {
      return opportunities;
    },
  };
}

// Build candidate facts in one place so tests stay readable.
function cand(
  protocol: string,
  effectiveYieldBps: number,
  tvlUsd: string,
  extra: Partial<Record<string, unknown>> = {},
): NormalizedOpportunity {
  return {
    asset: 'BNB',
    protocol,
    risk: 'LOW',
    tvlUsd,
    grossYieldBps: effectiveYieldBps,
    protocolFeeBps: 0,
    swapCostBps: 0,
    gasCostBps: 0,
    slippageBps: 0,
    riskAdjustmentBps: 0,
    effectiveYieldBps,
    ...(extra as unknown as NormalizedOpportunity),
  };
}

// A minimal but schema-valid agent.
const agent = {
  id: 'agent_1',
  name: 'YieldBot',
  description: 'test',
  type: 'trade' as const,
  ownerId: 'user_1',
  walletAddress: '0x123',
  status: 'ACTIVE' as const,
  capabilities: [{ id: 'PROPOSE_DEPOSIT' as const, name: 'Deposit' }],
  protocols: ['venus' as const],
  riskLevel: 'LOW' as const,
  strategyId: 'yield-optimisation',
};

// In-memory deterministic brain (mirrors DevBrainAdapter): returns a schema-valid
// ACT decision with a valid ActionProposal.
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
      strategyId: 'yield-optimisation',
      status: 'ACT',
      createdAt: now,
      rationale: 'chose top candidate',
      proposal: {
        proposalId: `prop_${this.counter}`,
        agentId: 'agent_1',
        userId: 'user_1',
        strategyId: 'yield-optimisation',
        sessionId: 'sess_1',
        protocol: 'venus',
        contract: '0xc',
        function: 'supply',
        action: 'DEPOSIT',
        capabilityId: 'PROPOSE_DEPOSIT',
        token: 'BNB',
        amount: '1000000000000000000',
        estimatedValue: '1000',
        asset: 'BNB',
        idempotencyKey: 'ik_1',
        nonce: '1',
        riskLevel: 'LOW',
        createdAt: now,
      },
    };
  }
}

describe('YieldNormalizer — deterministic cost model', () => {
  it('computes net yield = gross − protocolFee − swap − gas − slippage', () => {
    const n = new YieldNormalizer({ protocolFeeBps: { venus: 10 }, swapCostBps: 25, gasCostBps: 5, slippageBps: 30 });
    const out = n.normalize({ asset: 'BNB', protocol: 'venus', apyBps: 500, tvlUsd: '1000', risk: 'LOW', timestamp: 'now' });
    expect(out.protocolFeeBps).toBe(10);
    expect(out.swapCostBps).toBe(25);
    expect(out.gasCostBps).toBe(5);
    expect(out.slippageBps).toBe(30);
    expect(out.grossYieldBps).toBe(500);
  });
});

describe('YieldRiskModel', () => {
  it('applies integer risk adjustment per tier (LOW=0, MEDIUM=50, HIGH=100)', () => {
    const m = new YieldRiskModel();
    expect(m.adjustmentBps('LOW')).toBe(0);
    expect(m.adjustmentBps('MEDIUM')).toBe(50);
    expect(m.adjustmentBps('HIGH')).toBe(100);
  });

  it('fails closed on unknown risk tier', () => {
    const m = new YieldRiskModel();
    expect(() => m.adjustmentBps('EXTREME' as never)).toThrowError();
  });

  it('filters out opportunities whose risk exceeds the agent profile', () => {
    const m = new YieldRiskModel();
    const low = cand('a', 100, '1', { risk: 'LOW', grossYieldBps: 130 });
    const high = cand('b', 90, '1', { risk: 'HIGH', grossYieldBps: 500 });
    const out = m.apply([low, high], 'LOW');
    expect(out.length).toBe(1);
    expect(out[0].protocol).toBe('a');
  });
});

describe('YieldCandidateSelector', () => {
  it('ranks by effective yield desc, then TVL desc, then protocol alpha', () => {
    const sel = new YieldCandidateSelector(3);
    const ranked = sel.select([cand('zeta', 50, '100'), cand('alpha', 50, '100'), cand('mid', 50, '999')]);
    expect(ranked.map((c) => c.protocol)).toEqual(['mid', 'alpha', 'zeta']);
  });

  it('returns a bounded top-N set and assigns deterministic ranks', () => {
    const sel = new YieldCandidateSelector(2);
    const ranked = sel.select([cand('a', 10, '1'), cand('b', 30, '1'), cand('c', 20, '1')]);
    expect(ranked.length).toBe(2);
    expect(ranked[0].protocol).toBe('b');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].protocol).toBe('c');
  });

  it('filters opportunities with non-positive effective yield', () => {
    const sel = new YieldCandidateSelector(3);
    const out = sel.select([cand('bad', -5, '1'), cand('ok', 50, '1')]);
    expect(out.length).toBe(1);
    expect(out[0].protocol).toBe('ok');
  });

  it('tie-breaks deterministically (TVL desc, then protocol alpha)', () => {
    const sel = new YieldCandidateSelector(3);
    const out = sel.select([cand('zeta', 50, '100'), cand('alpha', 50, '100'), cand('mid', 50, '999')]);
    expect(out.map((c) => c.protocol)).toEqual(['mid', 'alpha', 'zeta']);
  });
});

describe('YieldDataProvider + ObservationBuilder (data boundary)', () => {
  it('converts APY percent to integer bps at the adapter boundary', async () => {
    const dp = new YieldDataProvider(fakeAdapter([{ asset: 'BNB', protocol: 'venus', apy: 5.5, tvlUsd: '10', risk: 'LOW', timestamp: 'now' }]));
    const opps = await dp.fetch('bnb-testnet');
    expect(opps[0].apyBps).toBe(550);
  });

  it('produces a schema-valid Observation with candidate facts only', () => {
    const ob = new ObservationBuilder('bnb-testnet', 'yield-optimisation');
    const obs = ob.build(agent as never, [cand('venus', 400, '1000')], { topN: 3 });
    // @ts-ignore — accessing structured data shape
    expect(obs.type).toBe('yield_opportunities');
    // @ts-ignore
    expect(obs.data.candidates[0].protocol).toBe('venus');
    // @ts-ignore — must NOT expose raw/execution payload
    expect(obs.data.raw).toBeUndefined();
  });

  it('observation enumerates per-candidate cost components', () => {
    const ob = new ObservationBuilder('bnb-testnet', 'yield-optimisation');
    const obs = ob.build(agent as never, [cand('venus', 10, '100')], { topN: 3 });
    const c = obs.data.candidates[0];
    expect(c.grossYieldBps).toBeDefined();
    expect(c.protocolFeeBps).toBeDefined();
    expect(c.slippageBps).toBeDefined();
    expect(c.riskAdjustmentBps).toBeDefined();
  });
});

describe('YieldStrategy end-to-end (hermetic, in-memory brain)', () => {
  it('observe() returns structured observations, not raw data', async () => {
    const brain = new RecordingBrain();
    const dp = new YieldDataProvider(fakeAdapter([{ asset: 'BNB', protocol: 'venus', apy: 5, tvlUsd: '1000', risk: 'LOW', timestamp: 'now' }]));
    const strat = new YieldStrategy({ brain: brain as never, data: dp });
    const obs = await strat.observe(agent as never, 'corr_1');
    expect(obs.length).toBe(1);
    expect(obs[0].data.candidates.length).toBeLessThanOrEqual(3);
  });

  it('decide() returns a schema-valid ActionProposal from a candidate', async () => {
    const brain = new RecordingBrain();
    const dp = new YieldDataProvider(fakeAdapter([{ asset: 'BNB', protocol: 'venus', apy: 5, tvlUsd: '1000', risk: 'LOW', timestamp: 'now' }]));
    const strat = new YieldStrategy({ brain: brain as never, data: dp });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it('returns null when the brain decides PASS (no proposal)', async () => {
    const passBrain = {
      async decide() {
        return { decisionId: 'dec_p', agentId: 'agent_1', strategyId: 'yield-optimisation', status: 'PASS', createdAt: new Date().toISOString() };
      },
    };
    const dp = new YieldDataProvider(fakeAdapter([{ asset: 'BNB', protocol: 'venus', apy: 5, tvlUsd: '1000', risk: 'LOW', timestamp: 'now' }]));
    const strat = new YieldStrategy({ brain: passBrain as never, data: dp });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).toBeNull();
  });

  it('throws on a genuinely invalid (non-ACT) malformed decision', async () => {
    const wrongBrain = { async decide() { return 'garbage payload'; } };
    const dp = new YieldDataProvider(fakeAdapter([{ asset: 'BNB', protocol: 'venus', apy: 5, tvlUsd: '1000', risk: 'LOW', timestamp: 'now' }]));
    const strat = new YieldStrategy({ brain: wrongBrain as never, data: dp });
    const obs = await strat.observe(agent as never, 'corr_1');
    await expect(strat.decide(obs[0], agent as never)).rejects.toThrow(BANError);
  });

  it('does not invoke PolicyEngine or ExecutionEngine — only the injected brain', async () => {
    const brain = new RecordingBrain();
    const dp = new YieldDataProvider(fakeAdapter([{ asset: 'BNB', protocol: 'venus', apy: 5, tvlUsd: '1000', risk: 'LOW', timestamp: 'now' }]));
    const strat = new YieldStrategy({ brain: brain as never, data: dp });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    // The brain was consulted exactly once; no policy/execution engine exists in-path.
    expect(brain.calls.length).toBe(1);
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });
});