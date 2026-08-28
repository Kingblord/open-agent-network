import { describe, it, expect } from 'vitest';
import { OpenRouterBrainAdapter } from '../src/openrouter-brain.js';
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

/** Build a fetch stub returning a fixed Response. Pass a body OBJECT (not a function). */
function makeFetch(body: unknown, init?: { status?: number }): typeof globalThis.fetch {
  const status = init?.status ?? 200;
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch;
}

describe('M7 OpenRouterBrainAdapter (live provider — network/API-gated)', () => {
  it('throws ERR_PROVIDER_UNAVAILABLE when no API key is configured', async () => {
    const brain = new OpenRouterBrainAdapter({ apiKey: '', fetch: makeFetch({}) });
    const err = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities }).then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe('ERR_PROVIDER_UNAVAILABLE');
  });

  it('FAILS CLOSED when the model returns an invalid decision (malformed JSON content)', async () => {
    const fetchMock = makeFetch({ choices: [{ message: { content: '{bad json' } }] });
    const brain = new OpenRouterBrainAdapter({ apiKey: 'sk-test', fetch: fetchMock });
    const err = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities }).then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe('ERR_POLICY_DENIED');
    expect(String(err.message)).toMatch(/failing closed/i);
  });

  it('FAILS CLOSED on a schema-invalid decision (missing required ActionProposal fields)', async () => {
    const badProposal = { proposalId: 'p1', agentId: 'agent_1' }; // missing many required
    const fetchMock = makeFetch({
      choices: [
        {
          message: {
            content: JSON.stringify({ status: 'ACT', reasoning: 'x', proposal: badProposal }),
          },
        },
      ],
    });
    const brain = new OpenRouterBrainAdapter({ apiKey: 'sk-test', fetch: fetchMock });
    const err = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities }).then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe('ERR_POLICY_DENIED');
  });

  it('returns a valid PASS decision when the model emits PASS', async () => {
    const fetchMock = makeFetch({
      choices: [{ message: { content: JSON.stringify({ status: 'PASS', reasoning: 'no action' }) } }],
    });
    const brain = new OpenRouterBrainAdapter({ apiKey: 'sk-test', fetch: fetchMock });
    const decision = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities });
    expect(decision.status).toBe('PASS');
    expect(StrategyDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('returns a schema-valid ACT proposal when the model emits a full valid proposal', async () => {
    const proposal = {
      proposalId: 'prop_9',
      agentId: 'agent_1',
      userId: 'user_1',
      sessionId: 'sess_1',
      protocol: 'pancake',
      contract: '0x0000000000000000000000000000000000000001',
      function: 'swap',
      action: 'SWAP',
      capabilityId: 'PROPOSE_SWAP',
      token: 'BNB',
      amount: '1000000000000000000',
      estimatedValue: '1000000000000000000',
      asset: 'BNB',
      idempotencyKey: 'ik_9',
      riskLevel: 'LOW',
      createdAt: '2026-08-26T00:00:00.000Z',
    };
    const fetchMock = makeFetch({
      choices: [{ message: { content: JSON.stringify({ status: 'ACT', reasoning: 'swap', proposal }) } }],
    });
    const brain = new OpenRouterBrainAdapter({ apiKey: 'sk-test', fetch: fetchMock });
    const decision = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities });
    expect(decision.status).toBe('ACT');
    expect(decision.proposal).toBeDefined();
    if (decision.proposal) {
      expect(ActionProposalSchema.safeParse(decision.proposal).success).toBe(true);
    }
  });

  it('propagates non-OK provider status as ERR_PROVIDER_UNAVAILABLE', async () => {
    const fetchMock = makeFetch('rate limited', { status: 429 });
    const brain = new OpenRouterBrainAdapter({ apiKey: 'sk-test', fetch: fetchMock });
    const err = await brain.decide({ agentId: 'agent_1', observations: [observation], capabilities }).then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe('ERR_PROVIDER_UNAVAILABLE');
  });
});