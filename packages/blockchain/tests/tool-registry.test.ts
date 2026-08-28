import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tool-registry.js';
import { DevDataProvider } from '../src/dev-provider.js';
import type { ActionProposal, ToolCapability } from '@ban/schemas';

const registry = new ToolRegistry(DevDataProvider.instance());

const ALL_CAPS: ToolCapability[] = [
  'READ_BALANCE',
  'READ_PRICE',
  'READ_YIELD',
  'READ_LENDING_POSITION',
  'READ_LP_POSITION',
  'PROPOSE_SWAP',
  'PROPOSE_LP_REBALANCE',
  'PROPOSE_LENDING_ACTION',
  'PROPOSE_GRID_ORDER',
];

function listTools(caps: ToolCapability[]): string[] {
  return registry.listTools(caps).map((t) => t.name);
}

describe('M6 ToolRegistry', () => {
  describe('listTools capability gating', () => {
    it('only exposes tools the agent has capability for', () => {
      const names = listTools(['READ_PRICE']);
      expect(names).toContain('getTokenPrice');
      expect(names).not.toContain('getTokenBalance');
      expect(names).not.toContain('simulateTransaction');
    });

    it('exposes read tools for full read capability set', () => {
      const readCaps: ToolCapability[] = [
        'READ_BALANCE',
        'READ_PRICE',
        'READ_YIELD',
        'READ_LENDING_POSITION',
        'READ_LP_POSITION',
      ];
      const names = listTools(readCaps);
      for (const tool of ['getTokenBalance', 'getTokenPrice', 'getPoolState', 'getPoolPosition', 'getYieldOpportunities', 'getLendingPosition', 'getHealthFactor']) {
        expect(names).toContain(tool);
      }
    });

    it('does not expose simulateTransaction without PROPOSE_SWAP', () => {
      expect(listTools(['READ_PRICE'])).not.toContain('simulateTransaction');
    });
  });

  describe('call: tool exists', () => {
    it('rejects a tool the AI invented (unknown tool fails closed)', async () => {
      const result = await registry.call('getEverything', {}, { agentCapabilities: ALL_CAPS });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ERR_TOOL_NOT_FOUND');
    });
  });

  describe('call: capability gating', () => {
    it('rejects a tool the agent lacks capability for', async () => {
      const result = await registry.call('getTokenPrice', { token: 'BNB' }, { agentCapabilities: ['READ_BALANCE'] });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ERR_CAPABILITY_NOT_GRANTED');
    });
  });

  describe('call: input validation', () => {
    it('rejects malformed input for a known tool', async () => {
      const result = await registry.call('getTokenPrice', { notToken: true }, { agentCapabilities: ALL_CAPS });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ERR_TOOL_INVALID_INPUT');
    });
  });

  describe('structured outputs (dev provider)', () => {
    it('getTokenBalance returns deterministic structured balance', async () => {
      const r = await registry.call('getTokenBalance', { token: '0x1', address: '0x2' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(r.output.balance).toMatch(/^\d+$/);
      expect(r.output.token).toBe('0x1');
    });

    it('getTokenPrice returns deterministic price', async () => {
      const r = await registry.call('getTokenPrice', { token: 'BNB' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(r.output.priceUsd).toMatch(/^\d+\.\d{2}$/);
    });

    it('getYieldOpportunities returns array-structured opportunities', async () => {
      const r = await registry.call('getYieldOpportunities', { network: 'bsc' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(Array.isArray(r.output.opportunities)).toBe(true);
      expect(r.output.opportunities[0].risk).toBeDefined();
    });

    it('getPoolState returns pool state', async () => {
      const r = await registry.call('getPoolState', { poolAddress: '0xpool' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(r.output.token0).toBeDefined();
      expect(r.output.token1).toBeDefined();
    });

    it('getPoolPosition returns LP position', async () => {
      const r = await registry.call('getPoolPosition', { poolAddress: '0xpool', owner: '0xowner' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(r.output.positionId).toBeDefined();
    });

    it('getLendingPosition + getHealthFactor cover READ_LENDING_POSITION', async () => {
      const r = await registry.call('getLendingPosition', { address: '0xa', protocol: 'venus' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(r.output.healthFactor).toBeGreaterThan(0);
    });

    it('getGasEstimate returns gas data', async () => {
      const r = await registry.call('getGasEstimate', { action: 'swap' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(r.output.gasWei).toMatch(/^\d+$/);
    });

    it('getTransactionStatus returns a status', async () => {
      const r = await registry.call('getTransactionStatus', { hash: '0xabc' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(['CONFIRMED', 'PENDING', 'REVERTED']).toContain(r.output.status);
    });

    it('all four strategy observation requirements are represented', async () => {
      const readCaps: ToolCapability[] = ['READ_BALANCE', 'READ_PRICE', 'READ_LP_POSITION', 'READ_YIELD', 'READ_LENDING_POSITION'];
      const names = listTools(readCaps);
      for (const t of ['getTokenBalance', 'getTokenPrice', 'getPoolState', 'getPoolPosition', 'getYieldOpportunities', 'getLendingPosition', 'getHealthFactor']) {
        expect(names).toContain(t);
      }
    });
  });

  describe('simulateTransaction PREFLIGHT', () => {
    // A fully-valid ActionProposal matching ActionProposalSchema. This is the
    // only input simulateTransaction accepts — it must NOT take arbitrary
    // AI-supplied raw transactions.
    const proposal: ActionProposal = {
      proposalId: 'prop_1',
      agentId: 'agent_1',
      userId: 'user_1',
      sessionId: 'sess_1',
      protocol: 'pancake',
      contract: '0xc',
      function: 'swap',
      action: 'SWAP',
      capabilityId: 'PROPOSE_SWAP',
      token: 'BNB',
      amount: '1000',
      estimatedValue: '1000',
      asset: 'BNB',
      idempotencyKey: 'ik_1',
      nonce: '1',
      riskLevel: 'LOW',
      createdAt: '2026-08-26T00:00:00.000Z',
    };

    it('preflights a validated proposal through the execution path', async () => {
      const r = await registry.call('simulateTransaction', proposal, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('expected ok');
      expect(r.output.proposalId).toBe('prop_1');
      expect(r.output.ok).toBe(true);
    });

    it('rejects an input that is not a valid ActionProposal', async () => {
      const r = await registry.call('simulateTransaction', { rawTx: '0xdeadbeef', to: '0x1' }, { agentCapabilities: ALL_CAPS });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('ERR_TOOL_INVALID_INPUT');
    });

    it('is not exposed to an agent without PROPOSE_SWAP', async () => {
      expect(listTools(['READ_PRICE'])).not.toContain('simulateTransaction');
    });
  });
});