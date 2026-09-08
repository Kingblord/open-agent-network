import { describe, it, expect } from 'vitest';
import {
  HealthRiskModel,
  HealthFactorCalculator,
  HealthCandidateSelector,
  ObservationBuilder,
  HealthDataProvider,
  HealthStrategy,
} from '../src/index.js';
import type { HealthSnapshot, HealthLendingSnapshot } from '../src/types.js';
import { ActionProposalSchema } from '@ban/schemas';
import { BANError } from '@ban/shared';

// Deterministic snapshot builders -------------------------------------------
function snap(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    address: '0xabc',
    protocol: 'venus',
    collateralCentsUsd: '200000', // $2,000
    debtCentsUsd: '100000', // $1,000
    ltvBps: 5500,
    liquidationThresholdBps: 8000, // 0.80
    // HF = 2000 * 0.8 / 1000 = 1.60 → 160
    healthFactorCents: 160,
    riskState: 'WARNING',
    currentLtvBps: 5500,
    liquidationThresholdAppliedBps: 8000,
    timestamp: 'now',
    ...over,
  };
}

function raw(over: Partial<HealthLendingSnapshot> = {}): HealthLendingSnapshot {
  return {
    address: '0xabc',
    protocol: 'venus',
    collateral: '200000', // integer cents
    borrowed: '145455', // HF = 200000*0.8/145455 ≈ 1.10 → CRITICAL (candidates exist)
    ltv: 0.55,
    liquidationThreshold: 0.8,
    healthFactor: 1.1, // HF 110 → CRITICAL so observe() carries a REPAY candidate
    assetPrices: { BNB: '30000', USDT: '10000' },
    timestamp: 'now',
    ...over,
  };
}

// Minimal schema-valid agent.
const agent = {
  id: 'agent_1',
  name: 'HealthBot',
  description: 'test',
  type: 'lending' as const,
  ownerId: 'user_1',
  walletAddress: '0xabc',
  status: 'ACTIVE' as const,
  capabilities: [{ id: 'PROPOSE_REPAY' as const, name: 'Repay' }],
  protocols: ['venus' as const],
  riskLevel: 'LOW' as const,
  strategyId: 'health-factor-monitor',
};

// In-memory deterministic brain (mirrors DevBrainAdapter).
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
      strategyId: 'health-factor-monitor',
      status: 'ACT',
      createdAt: now,
      reasoning: 'chose corrective action',
      proposal: {
        proposalId: `prop_${this.counter}`,
        agentId: 'agent_1',
        userId: 'user_1',
        strategyId: 'health-factor-monitor',
        sessionId: 'sess_1',
        protocol: 'venus',
        contract: '0xven',
        function: 'repay',
        action: 'TRANSFER',
        capabilityId: 'PROPOSE_REPAY',
        token: 'USDT',
        amount: '1000',
        estimatedValue: '1000',
        asset: 'USDT',
        params: {},
        idempotencyKey: `ik_${this.counter}`,
        nonce: '1',
        riskLevel: 'MEDIUM',
        createdAt: now,
      },
    };
  }
}

describe('HealthFactorCalculator — integer math', () => {
  it('HF = collateral * threshold / debt (in integer cents)', () => {
    const c = new HealthFactorCalculator();
    // 2000 * 0.8 / 1000 = 1.60 → 160
    expect(c.healthFactorCents('2000', '1000', 8000)).toBe(160);
  });

  it('repayNeededCents repays just enough to reach a target HF', () => {
    const c = new HealthFactorCalculator();
    // HF 1.60, collateral 2000, threshold 0.8 → to reach HF 2.0:
    // maxDebt = 2000*0.8/2.0 = 800; repay needed = 1000 - 800 = 200
    expect(c.repayNeededCents('2000', '1000', 8000, 200)).toBe('200');
  });

  it('returns 0 when already above the target HF', () => {
    const c = new HealthFactorCalculator();
    expect(c.repayNeededCents('2000', '1000', 8000, 100)).toBe('0');
  });
});

describe('HealthRiskModel — categorical state', () => {
  it('maps HF cents to HEALTHY/WARNING/CRITICAL/EMERGENCY', () => {
    const m = new HealthRiskModel();
    expect(m.stateFor(220)).toBe('HEALTHY');
    expect(m.stateFor(180)).toBe('WARNING');
    expect(m.stateFor(120)).toBe('CRITICAL');
    expect(m.stateFor(90)).toBe('EMERGENCY');
  });

  it('fails closed on unknown/invalid health factor', () => {
    const m = new HealthRiskModel();
    expect(() => m.stateFor(NaN)).toThrow(BANError);
    expect(() => m.stateFor(-1)).toThrow(BANError);
  });
});

describe('HealthCandidateSelector — deterministic corrective actions', () => {
  it('returns no corrective action for HEALTHY/WARNING (AI should PASS)', () => {
    const s = new HealthCandidateSelector();
    expect(s.select(snap({ riskState: 'HEALTHY' }))).toEqual([]);
    expect(s.select(snap({ riskState: 'WARNING' }))).toEqual([]);
  });

  it('CRITICAL → one REPAY candidate', () => {
    const s = new HealthCandidateSelector();
    const cands = s.select(snap({ riskState: 'CRITICAL' }));
    expect(cands.length).toBe(1);
    expect(cands[0].action).toBe('REPAY');
    expect(Number(cands[0].amountCentsUsd)).toBeGreaterThan(0);
  });

  it('EMERGENCY → REPAY (priority) + ADD_COLLATERAL alternative', () => {
    const s = new HealthCandidateSelector();
    const cands = s.select(snap({ riskState: 'EMERGENCY' }));
    expect(cands.length).toBe(2);
    expect(cands[0].action).toBe('REPAY');
    expect(cands[1].action).toBe('ADD_COLLATERAL');
  });
});

describe('HealthDataProvider — adapter boundary (dev provider)', () => {
  it('converts raw lending snapshot to integer cents / integer bps snapshot', async () => {
    const provider = new HealthDataProvider(
      {
        async getLendingPosition() {
          return { collateral: '2000', borrowed: '1000', ltv: 0.55, liquidationThreshold: 0.8, healthFactor: 1.6, timestamp: 'now' };
        },
      } as never,
      {
        async getTokenPrice(token: string) {
          return { asset: token, priceUsd: '12.34', timestamp: 'now' };
        },
      } as never,
    );
    const out = await provider.fetch('0xabc', 'venus', ['BNB', 'USDT'], ['USDT']);
    expect(out.collateralCentsUsd).toBe('2000');
    expect(out.debtCentsUsd).toBe('1000');
    expect(out.liquidationThresholdBps).toBe(8000);
    expect(out.healthFactorCents).toBe(160);
    expect(out.riskState).toBe('WARNING');
  });
});

describe('ObservationBuilder — schema-valid, facts only', () => {
  it('produces a structured health observation (no raw payload)', () => {
    const ob = new ObservationBuilder('health-factor-monitor');
    const obs = ob.build(agent as never, snap(), []);
    // @ts-ignore — structured graph shape
    expect(obs.type).toBe('health_factor');
    // @ts-ignore
    expect(obs.data.riskState).toBe('WARNING');
    // @ts-ignore — must not expose raw/execution payload
    expect(obs.data.raw).toBeUndefined();
  });

  it('enumerates candidate facts (action, amount, targetState)', () => {
    const ob = new ObservationBuilder('health-factor-monitor');
    const cand = { action: 'REPAY', protocol: 'venus', address: '0xabc', targetState: 'HEALTHY', fromState: 'CRITICAL', amountCentsUsd: '25000', rank: 1 };
    const obs = ob.build(agent as never, snap(), [cand as never]);
    const c = obs.data.candidates[0];
    expect(c.action).toBe('REPAY');
    expect(c.amountCentsUsd).toBe('25000');
    expect(c.targetState).toBe('HEALTHY');
  });
});

describe('HealthStrategy end-to-end (hermetic, in-memory brain)', () => {
  it('observe() returns a structured observation, not raw data', async () => {
    const brain = new RecordingBrain();
    const provider = new HealthDataProvider(
      { async getLendingPosition() { return raw(); } } as never,
      { async getTokenPrice(t: string) { return { asset: t, priceUsd: '1.0', timestamp: 'now' }; } } as never,
    );
    const strat = new HealthStrategy({ brain: brain as never, data: provider });
    const obs = await strat.observe(agent as never, 'corr_1');
    expect(obs.length).toBe(1);
    // @ts-ignore
    expect(obs[0].type).toBe('health_factor');
  });

  it('decide() returns a schema-valid ActionProposal from a candidate', async () => {
    const brain = new RecordingBrain();
    const provider = new HealthDataProvider(
      { async getLendingPosition() { return raw(); } } as never,
      { async getTokenPrice(t: string) { return { asset: t, priceUsd: '1.0', timestamp: 'now' }; } } as never,
    );
    const strat = new HealthStrategy({ brain: brain as never, data: provider });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it('returns null when the brain decides PASS', async () => {
    const passBrain = {
      async decide() {
        return { decisionId: 'dec_p', agentId: 'agent_1', strategyId: 'health-factor-monitor', status: 'PASS', createdAt: new Date().toISOString() };
      },
    };
    const provider = new HealthDataProvider(
      { async getLendingPosition() { return raw(); } } as never,
      { async getTokenPrice(t: string) { return { asset: t, priceUsd: '1.0', timestamp: 'now' }; } } as never,
    );
    const strat = new HealthStrategy({ brain: passBrain as never, data: provider });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).toBeNull();
  });

  it('fails closed on malformed (non-ACT) brain output', async () => {
    const wrongBrain = { async decide() { return 'garbage'; } };
    const provider = new HealthDataProvider(
      { async getLendingPosition() { return raw(); } } as never,
      { async getTokenPrice(t: string) { return { asset: t, priceUsd: '1.0', timestamp: 'now' }; } } as never,
    );
    const strat = new HealthStrategy({ brain: wrongBrain as never, data: provider });
    const obs = await strat.observe(agent as never, 'corr_1');
    await expect(strat.decide(obs[0], agent as never)).rejects.toThrow(BANError);
  });

  it('does not invoke PolicyEngine or ExecutionEngine — only the injected brain', async () => {
    const brain = new RecordingBrain();
    const provider = new HealthDataProvider(
      { async getLendingPosition() { return raw(); } } as never,
      { async getTokenPrice(t: string) { return { asset: t, priceUsd: '1.0', timestamp: 'now' }; } } as never,
    );
    const strat = new HealthStrategy({ brain: brain as never, data: provider });
    const obs = await strat.observe(agent as never, 'corr_1');
    const proposal = await strat.decide(obs[0], agent as never);
    expect(proposal).not.toBeNull();
    expect(brain.calls.length).toBe(1);
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });
});

describe('RiskLevel is deterministic — never the LLM word (regression)', () => {
  it('REPAY proposal riskLevel is LOW regardless of a model-invented HIGH/CRITICAL', async () => {
    const { canonicalizeHealthProposal } = await import('../src/canonical-proposal.js');
    const obs = {
      data: {
        candidates: [
          {
            action: 'REPAY',
            protocol: 'venus',
            address: '0xaaC9A2dEf0Ec845F81AD760b2D95cD5059Cc8cF5',
            targetState: 'HEALTHY',
            fromState: 'CRITICAL',
            amountCentsUsd: '280',
            amountWei: '2800000000000000000',
            denomination: 'USDC',
            rank: 1,
          },
        ],
      },
    };
    // Model labeled the POSITION "CRITICAL" — normalizeRiskLevel mapped it to
    // HIGH. That must NOT reach policy: a protective repayment on a LOW-risk
    // agent would be wrongly denied ('Risk HIGH incompatible with agent risk
    // LOW' was the production failure).
    const modelProposal = {
      proposalId: 'prop_risk',
      agentId: 'ag_test',
      userId: 'user_test',
      sessionId: 'sess_test',
      protocol: 'venus',
      contract: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
      function: 'repayBorrow',
      action: 'DEPOSIT',
      capabilityId: 'PROPOSE_REPAY',
      token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      amount: '2800000000000000000',
      estimatedValue: '2800000000000000000',
      asset: 'USDC',
      params: { requestedAction: 'REPAY' },
      idempotencyKey: 'ik_risk',
      riskLevel: 'HIGH',
      createdAt: new Date().toISOString(),
    };
    const out = canonicalizeHealthProposal(modelProposal, obs as never);
    expect(out).not.toBeNull();
    expect(out!.riskLevel).toBe('LOW'); // deterministic — REPAY is protective
  });
});