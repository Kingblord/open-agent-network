import { describe, it, expect } from 'vitest';
import { DevBrainAdapter } from '../src/dev-brain.js';
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import type { Observation } from '@ban/schemas';

const observation: Observation = {
  id: 'obs_1',
  agentId: 'agent_1',
  type: 'market',
  data: { bnbPriceUsd: '620.50', trend: 'stable' },
  observedAt: '2026-08-26T00:00:00.000Z',
};

const capabilities = ['READ_PRICE', 'READ_BALANCE', 'PROPOSE_SWAP'];

describe('M7 DevBrainAdapter', () => {
  it('returns a schema-valid PASS when no action is warranted', async () => {
    const brain = new DevBrainAdapter();
    const decision = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities });
    expect(decision.status).toBe('PASS');
    expect(decision.agentId).toBe('agent_1');
    expect(StrategyDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('FAILS CLOSED (PASS) when an act capability is NOT granted', async () => {
    const brain = new DevBrainAdapter({ actCapability: 'PROPOSE_SWAP' });
    const decision = await brain.decide({
      agentId: 'agent_1',
      observations: [observation],
      capabilities: ['READ_PRICE'], // no PROPOSE_SWAP
    });
    expect(decision.status).toBe('PASS');
  });

  it('emits a valid ACT proposal when the capability IS granted', async () => {
    const brain = new DevBrainAdapter({ actCapability: 'PROPOSE_SWAP' });
    const decision = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities });
    expect(decision.status).toBe('ACT');
    expect(decision.proposal).toBeDefined();
    if (decision.proposal) {
      expect(decision.proposal.action).toBe('SWAP');
      expect(ActionProposalSchema.safeParse(decision.proposal).success).toBe(true);
    }
    // Every decision envelope itself is valid too.
    expect(StrategyDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('alwaysDenyReason forces a fail-closed PASS with a deny reason', async () => {
    const brain = new DevBrainAdapter({ actCapability: 'PROPOSE_SWAP', alwaysDenyReason: 'risk-unknown' });
    const decision = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities });
    expect(decision.status).toBe('PASS');
    expect(decision.deniedReason).toBe('risk-unknown');
  });

  it('ties observed risk into PASS when risk is unknown (fail-closed posture)', async () => {
    // a strategy with unknown risk must never auto-ACT; deterministic PASS is
    // the safe baseline when no risk info is supplied.
    const brain = new DevBrainAdapter();
    const decision = await brain.decide({ agentId: 'agent_1', observations: [], capabilities });
    expect(decision.status).toBe('PASS');
  });
});