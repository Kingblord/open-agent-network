import { describe, it, expect } from 'vitest';
import {
  toAuthorizationTuple,
  fromAuthorizationTuple,
  computeAuthority,
  buildDelegationState,
  permissionConfigHash,
  delegationForPermission,
  assertActivatable,
  nextPermissionNonce,
} from '../src/index.js';
import { AgentPermissionSchema, DelegationStateSchema } from '@ban/schemas';
import { BANError } from '@ban/shared';

// A minimal, valid permission (fresh, full config). Uses no network.
function makePermission(overrides: Partial<Record<string, unknown>> = {}): AgentPermission {
  return {
    id: 'perm_test',
    agentId: 'agent_1',
    userId: 'user_1',
    userAddress: '0x1111111111111111111111111111111111111111',
    jobId: 'job_1',
    capabilities: ['PROPOSE_SWAP'],
    allowedProtocols: ['pancakeswap'],
    allowedContracts: ['0x2222222222222222222222222222222222222222'],
    allowedFunctions: ['swapExactTokensForTokens'],
    allowedTokens: ['BNB'],
    spend: {
      spendLimit: '1000000000000000000000',
      perTransactionCap: '100000000000000000000',
      used: '0',
      asset: 'BNB',
    },
    validAfter: new Date(Date.now() - 1000).toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    nonce: '1',
    onchainRegistryReference: null,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAuth() {
  return {
    chainId: 56,
    address: '0x3333333333333333333333333333333333333333',
    nonce: 1n,
    yParity: 0,
    r: 0x111111111111111111111111111111111111111111111111111111111111111111111111n,
    s: 0x222222222222222222222222222222222222222222222222222222222222222222222222n,
  };
}

describe('toAuthorizationTuple / fromAuthorizationTuple — roundtrip', () => {
  it('produces the canonical 6-element tuple and back', () => {
    const auth = makeAuth();
    const tuple = toAuthorizationTuple(auth);
    expect(tuple).toHaveLength(6);
    expect(tuple[0]).toBe(56);
    expect(tuple[1]).toBe(auth.address);
    expect(tuple[4]).toBe(auth.r);
    expect(tuple[5]).toBe(auth.s);
    expect(fromAuthorizationTuple(tuple)).toEqual(auth);
  });
});

describe('computeAuthority — deterministic binding', () => {
  it('derives keccak(user ‖ agent ‖ configHash)', () => {
    const a = computeAuthority({
      userAddress: '0x1111111111111111111111111111111111111111',
      agentId: 'agent_1',
      configHash: '0x' + 'ab'.repeat(32),
    });
    expect(a).toMatch(/^0x[a-f0-9]{64}$/i);
  });

  it('throws on an invalid user address (fail-closed)', () => {
    expect(() =>
      computeAuthority({ userAddress: 'not-an-address', agentId: 'a', configHash: '0x' + 'ab'.repeat(32) }),
    ).toThrow(BANError);
  });

  it('throws on an invalid configHash', () => {
    expect(() =>
      computeAuthority({ userAddress: '0x1111111111111111111111111111111111111111', agentId: 'a', configHash: '0x00' }),
    ).toThrow(BANError);
  });
});

describe('permissionConfigHash — deterministic config binding', () => {
  it('is stable for identical config, changes when a limit changes', () => {
    const base = makePermission();
    const h1 = permissionConfigHash(base);
    // Hash the SAME object so timestamps/validity don't drift.
    const h2 = permissionConfigHash({ ...base });
    expect(h1).toEqual(h2);

    const changed = makePermission({ spend: { ...base.spend, spendLimit: '999' } });
    expect(permissionConfigHash(changed)).not.toEqual(h1);
  });

  it('fails when spendLimit is missing (fail-closed)', () => {
    const missing = makePermission({ spend: undefined });
    expect(() => permissionConfigHash(missing)).toThrow(BANError);
  });
});

describe('buildDelegationState / delegationForPermission', () => {
  it('produces a schema-valid PENDING delegation state with authority + configHash', () => {
    const perm = makePermission();
    const state = buildDelegationState({
      userAddress: perm.userAddress,
      agentId: perm.agentId,
      delegateAddress: '0x3333333333333333333333333333333333333333',
      configHash: permissionConfigHash(perm),
      nonce: perm.nonce,
      validAfter: perm.validAfter,
      validUntil: perm.validUntil,
    });
    expect(DelegationStateSchema.safeParse(state).success).toBe(true);
    expect(state.status).toBe('PENDING');
    expect(state.authority).toMatch(/^0x[a-f0-9]{64}$/i);
  });

  it('active delegation binds the exact config hash', () => {
    const perm = makePermission();
    const state = delegationForPermission(perm, '0x3333333333333333333333333333333333333333');
    expect(state.status).toBe('ACTIVE');
    expect(state.configHash).toEqual(permissionConfigHash(perm));
  });
});

describe('assertActivatable — fail-closed lifecycle', () => {
  it('accepts a fresh, in-window permission', () => {
    assertActivatable(makePermission());
  });

  it('rejects a non-PENDING permission', () => {
    expect(() => assertActivatable(makePermission({ status: 'ACTIVE' }))).toThrow(BANError);
  });

  it('rejects an expired permission', () => {
    expect(() =>
      assertActivatable(makePermission({ validUntil: new Date(Date.now() - 1000).toISOString() })),
    ).toThrow(BANError);
  });

  it('rejects a non-positive spendLimit', () => {
    expect(() =>
      assertActivatable(makePermission({ spend: { ...makePermission().spend, spendLimit: '0' } })),
    ).toThrow(BANError);
  });
});

describe('nextPermissionNonce', () => {
  it('increments monotonically from a prior nonce', () => {
    expect(nextPermissionNonce('5')).toBe('6');
    expect(nextPermissionNonce(undefined)).toBe('1');
  });
});