import { describe, expect, it } from 'vitest';
import type { AgentPermission } from '@ban/schemas';
import {
  DelegationAuthorizationBuilder,
  DelegationAuthorizationVerifier,
  PermissionResolver,
  EIP7702Error,
} from '../src/index.js';

function makePermission(overrides: Partial<AgentPermission> = {}): AgentPermission {
  const now = new Date().toISOString();
  return {
    id: 'perm_1',
    agentId: 'ag_1',
    userId: '0xUser',
    delegation: {
      chainId: 56,
      address: '0xImpl',
      nonce: 0,
      yParity: 0,
      r: '0x1',
      s: '0x2',
    },
    capabilities: ['SWAP'],
    allowedProtocols: [],
    allowedContracts: [],
    allowedFunctions: [],
    allowedTokens: [],
    spend: { spendLimit: '1000', perTransactionCap: '100', used: '0', asset: 'BNB' },
    nonce: 'perm-nonce-1',
    status: 'ACTIVE',
    activationTxHash: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('DelegationAuthorizationBuilder', () => {
  it('builds an authorization tuple via the injected signer', async () => {
    const builder = new DelegationAuthorizationBuilder(async ({ address, implAddress, chainId, nonce }) => {
      return { chainId, address: implAddress, nonce, yParity: 0, r: '0xr', s: '0xs' };
    });
    const auth = await builder.build(
      { address: '0xUser', implAddress: '0xImpl', chainId: 56 },
      3n,
    );
    expect(auth.address).toBe('0xImpl');
    expect(auth.chainId).toBe(56);
    expect(auth.nonce).toBe(3n);
  });

  it('refuses to fabricate a signature when no signer backend exists', async () => {
    const builder = new DelegationAuthorizationBuilder(undefined as never);
    await expect(
      builder.build({ address: '0xUser', implAddress: '0xImpl', chainId: 56 }, 0n),
    ).rejects.toThrow(EIP7702Error);
  });
});

describe('DelegationAuthorizationVerifier', () => {
  it('accepts a valid tuple whose recovered signer equals the user', async () => {
    const verifier = new DelegationAuthorizationVerifier(async (auth) =>
      auth.address === '0xImpl' ? '0xUser' : '0xOther',
    );
    const permission = makePermission();
    const result = await verifier.verify({
      permission,
      chainId: 56,
      implAddress: '0xImpl',
      expectedUser: '0xUser',
    });
    expect(result.signerMatchesUser).toBe(true);
    expect(result.signer).toBe('0xUser');
  });

  it('rejects when the chain id does not match', async () => {
    const verifier = new DelegationAuthorizationVerifier(async () => '0xUser');
    const permission = makePermission({ delegation: { ...makePermission().delegation, chainId: 97 } });
    await expect(
      verifier.verify({
        permission,
        chainId: 56,
        implAddress: '0xImpl',
        expectedUser: '0xUser',
      }),
    ).rejects.toThrow(EIP7702Error);
  });

  it('rejects when the impl address does not match configured', async () => {
    const verifier = new DelegationAuthorizationVerifier(async () => '0xUser');
    await expect(
      verifier.verify({
        permission: makePermission(),
        chainId: 56,
        implAddress: '0xOtherImpl',
        expectedUser: '0xUser',
      }),
    ).rejects.toThrow(EIP7702Error);
  });

  it('rejects when the recovered signer is not the user (fail-closed)', async () => {
    const verifier = new DelegationAuthorizationVerifier(async () => '0xAttacker');
    await expect(
      verifier.verify({
        permission: makePermission(),
        chainId: 56,
        implAddress: '0xImpl',
        expectedUser: '0xUser',
      }),
    ).rejects.toThrow(EIP7702Error);
  });

  it('refuses to claim validity when no recovery backend is configured', async () => {
    const verifier = new DelegationAuthorizationVerifier(undefined as never);
    await expect(
      verifier.verify({
        permission: makePermission(),
        chainId: 56,
        implAddress: '0xImpl',
        expectedUser: '0xUser',
      }),
    ).rejects.toThrow(EIP7702Error);
  });
});

describe('PermissionResolver', () => {
  it('resolves an ACTIVE permission within scope', () => {
    const resolver = new PermissionResolver();
    const permission = makePermission({
      allowedProtocols: ['pancakeswap'],
      allowedContracts: ['0xRouter'],
      allowedFunctions: ['swapExactTokensForTokens'],
      allowedTokens: ['0xUsdt'],
    });
    const resolved = resolver.resolve(permission, {
      protocol: 'pancakeswap',
      contract: '0xRouter',
      functionName: 'swapExactTokensForTokens',
      token: '0xUsdt',
      amount: '10',
    });
    expect(resolved.id).toBe('perm_1');
  });

  it('fails closed when permission is missing', () => {
    const resolver = new PermissionResolver();
    expect(() =>
      resolver.resolve(null, {
        protocol: 'pancakeswap',
        contract: '0xRouter',
        functionName: 'swapExactTokensForTokens',
        token: '0xUsdt',
        amount: '10',
      }),
    ).toThrow(EIP7702Error);
  });

  it('fails closed when permission is not ACTIVE', () => {
    const resolver = new PermissionResolver();
    const permission = makePermission({ status: 'REVOKED' });
    expect(() =>
      resolver.resolve(permission, {
        protocol: 'pancakeswap',
        contract: '0xRouter',
        functionName: 'swapExactTokensForTokens',
        token: '0xUsdt',
        amount: '10',
      }),
    ).toThrow(EIP7702Error);
  });

  it('fails closed when contract is out of scope', () => {
    const resolver = new PermissionResolver();
    const permission = makePermission({
      allowedProtocols: ['pancakeswap'],
      allowedContracts: ['0xRouter'],
      allowedFunctions: ['swapExactTokensForTokens'],
      allowedTokens: ['0xUsdt'],
    });
    expect(() =>
      resolver.resolve(permission, {
        protocol: 'pancakeswap',
        contract: '0xEvil',
        functionName: 'swapExactTokensForTokens',
        token: '0xUsdt',
        amount: '10',
      }),
    ).toThrow(EIP7702Error);
  });

  it('fails closed when per-transaction cap is exceeded', () => {
    const resolver = new PermissionResolver();
    const permission = makePermission({ spend: { spendLimit: '1000', perTransactionCap: '100', used: '0', asset: 'BNB' } });
    expect(() =>
      resolver.resolve(permission, {
        protocol: 'pancakeswap',
        contract: '0xRouter',
        functionName: 'swapExactTokensForTokens',
        token: '0xUsdt',
        amount: '101',
      }),
    ).toThrow(EIP7702Error);
  });

  it('fails closed when cumulative spend limit is exceeded', () => {
    const resolver = new PermissionResolver();
    const permission = makePermission({
      spend: { spendLimit: '100', perTransactionCap: '100', used: '95', asset: 'BNB' },
    });
    expect(() =>
      resolver.resolve(permission, {
        protocol: 'pancakeswap',
        contract: '0xRouter',
        functionName: 'swapExactTokensForTokens',
        token: '0xUsdt',
        amount: '10',
      }),
    ).toThrow(EIP7702Error);
  });

  it('fails closed when expired', () => {
    const resolver = new PermissionResolver();
    const permission = makePermission({
      validUntil: new Date(Date.now() - 1000).toISOString(),
    });
    expect(() =>
      resolver.resolve(permission, {
        protocol: 'pancakeswap',
        contract: '0xRouter',
        functionName: 'swapExactTokensForTokens',
        token: '0xUsdt',
        amount: '10',
      }),
    ).toThrow(EIP7702Error);
  });
});
