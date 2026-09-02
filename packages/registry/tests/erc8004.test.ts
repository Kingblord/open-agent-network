import { describe, it, expect } from 'vitest';
import {
  Erc8004Registry,
  normalizeExternalErc8004Record,
  type Erc8004AgentListing,
} from '../src/erc8004.js';

describe('Erc8004Registry', () => {
  it('registers the four BAN-native agents by default', () => {
    const reg = new Erc8004Registry();
    const native = reg.listNative();
    expect(native.length).toBe(4);
    const ids = native.map((n) => n.id).sort();
    expect(ids).toEqual([
      'ban-grid-trader',
      'ban-health-guard',
      'ban-lp-rebalancer',
      'ban-yield-optimizer',
    ]);
  });

  it('native listings are verified and reputation-neutral (no fabricated scores)', () => {
    const reg = new Erc8004Registry();
    for (const l of reg.listNative()) {
      expect(l.source).toBe('BAN_NATIVE');
      expect(l.registry?.verified).toBe(true);
      expect(l.reputation).toBeNull(); // never synthetic
      expect(l.status).toBe('REGISTERED');
    }
  });

  it('getById works case-insensitively', () => {
    const reg = new Erc8004Registry();
    expect(reg.getById('BAN-YIELD-OPTIMIZER')?.id).toBe('ban-yield-optimizer');
    expect(reg.getById('missing')).toBeNull();
  });

  it('normalizes external records into the listing shape with verified=false', () => {
    const rec = normalizeExternalErc8004Record(
      {
        agentId: 'ext-1',
        name: 'External Yield Bot',
        capabilities: ['READ_YIELD'],
        protocols: ['aave'],
        riskLevel: 'high',
        reputationScore: '0.92',
        reputationSource: 'erc8004-registry',
      },
      0,
    );
    expect(rec.id).toBe('ext-1');
    expect(rec.source).toBe('EXTERNAL');
    expect(rec.riskLevel).toBe('HIGH');
    expect(rec.registry?.verified).toBe(false);
    // Reputation only from a real provided source; still unverified (no silent claim).
    expect(rec.reputation).toEqual({ score: '0.92', source: 'erc8004-registry', verified: false });
  });

  it('external record without reputation stays reputation=null', () => {
    const rec = normalizeExternalErc8004Record({ agentId: 'ext-2', name: 'No Rep Bot' });
    expect(rec.reputation).toBeNull();
  });

  it('ingestExternal registers and separates native vs external', () => {
    const reg = new Erc8004Registry();
    reg.ingestExternal([{ agentId: 'ext-a', name: 'A' }, { agentId: 'ext-b', name: 'B' }]);
    expect(reg.listExternal().length).toBe(2);
    expect(reg.listNative().length).toBe(4);
    expect(reg.listAll().length).toBe(6);
  });

  it('external listings never overwrite BAN-native ones by id', () => {
    const reg = new Erc8004Registry();
    reg.ingestExternal([{ agentId: 'ban-yield-optimizer', name: 'Spoofed' }]);
    // Native stays authoritative.
    const native = reg.getById('ban-yield-optimizer');
    expect(native?.name).toBe('BAN Yield Optimizer');
    expect(native?.source).toBe('BAN_NATIVE');
  });
});