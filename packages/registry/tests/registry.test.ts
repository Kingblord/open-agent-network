import { describe, it, expect } from 'vitest';
import {
  TokenRegistry,
  ProtocolRegistry,
  ContractRegistry,
  AbiRegistry,
  DeploymentRegistry,
  BnbAddressVerifier,
  isValidAddress,
  assertSameAddress,
} from '../src/index.js';
import { BANError, ErrorCode } from '@ban/shared';

const MAINNET = 56;
const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const ADDR_C = '0x3333333333333333333333333333333333333333';

describe('AddressVerifier', () => {
  it('accepts structural 0x + 40 hex', () => {
    expect(isValidAddress(ADDR_A)).toBe(true);
  });
  it('rejects non-hex / wrong length', () => {
    expect(isValidAddress('0x123')).toBe(false);
    expect(isValidAddress('1234')).toBe(false);
  });
  it('compares addresses case-insensitively via constant-time check', () => {
    expect(assertSameAddress(ADDR_A, '0x' + ADDR_A.slice(2).toUpperCase())).toBe(true);
    expect(assertSameAddress(ADDR_A, ADDR_B)).toBe(false);
  });
  it('BnbAddressVerifier rejects wrong chain (testnet 97 vs mainnet 56)', () => {
    const v = new BnbAddressVerifier({ chainId: MAINNET });
    const ok = v.verify(ADDR_A, 97);
    expect(ok.ok).toBe(false);
  });
});

describe('TokenRegistry (fail-closed allowlist)', () => {
  const registry = new TokenRegistry({
    chainId: MAINNET,
    tokens: [
      { id: 'bnb', chainId: MAINNET, address: ADDR_A, symbol: 'BNB', name: 'BNB', decimals: 18, verified: true, enabled: true, native: true },
      { id: 'usdt', chainId: MAINNET, address: ADDR_B, symbol: 'USDT', name: 'Tether', decimals: 18, verified: true, enabled: false },
    ],
  });

  it('allows a verified + enabled token', () => {
    expect(registry.isEnabled('BNB')).toBe(true);
    expect(() => registry.requireEnabled('BNB')).not.toThrow();
  });

  it('denies an unknown token', () => {
    expect(registry.isEnabled('NOPE')).toBe(false);
    expect(() => registry.requireEnabled('NOPE')).toThrowError(BANError);
    try {
      registry.requireEnabled('NOPE');
    } catch (err) {
      expect((err as BANError).code).toBe(ErrorCode.TOKEN_NOT_ALLOWED);
    }
  });

  it('denies a verified but NOT enabled token (verified ≠ enabled)', () => {
    expect(registry.isEnabled('USDT')).toBe(false);
    expect(() => registry.requireEnabled('USDT')).toThrowError(/not enabled/);
  });

  it('denies an address actually on testnet (97) since BAN execution chain is 56', () => {
    try {
      new TokenRegistry({
        chainId: MAINNET,
        tokens: [{ id: 'bad', chainId: 97, address: ADDR_C, symbol: 'BAD', name: 'Bad', decimals: 18, verified: true, enabled: true }],
      });
      throw new Error('should not register testnet token on mainnet registry');
    } catch (err) {
      expect((err as BANError).code).toBe(ErrorCode.TOKEN_NOT_ALLOWED);
    }
  });
});

describe('ProtocolRegistry (ACTIVE + chain gate)', () => {
  const registry = new ProtocolRegistry({
    chainId: MAINNET,
    protocols: [
      { id: 'pancakeswap', chainId: MAINNET, name: 'PancakeSwap', status: 'ACTIVE', official: true },
      { id: 'venus', chainId: MAINNET, name: 'Venus', status: 'PAUSED' },
    ],
  });

  it('allows an ACTIVE protocol on the BAN chain', () => {
    expect(registry.isActive('pancakeswap')).toBe(true);
    expect(() => registry.requireActive('pancakeswap')).not.toThrow();
  });

  it('denies an unknown protocol', () => {
    expect(() => registry.requireActive('ghost')).toThrowError(/not registered/);
  });

  it('denies a PAUSED protocol', () => {
    expect(registry.isActive('venus')).toBe(false);
    expect(() => registry.requireActive('venus')).toThrowError(/not active/);
  });
});

describe('DeploymentRegistry (verified address per role)', () => {
  const registry = new DeploymentRegistry({
    chainId: MAINNET,
    deployments: [
      {
        protocolId: 'pancakeswap',
        chainId: MAINNET,
        contracts: { router: ADDR_A, factory: ADDR_B },
        verified: true,
      },
    ],
  });

  it('resolves a verified role address', () => {
    expect(registry.requireAddress('pancakeswap', 'router')).toBe(ADDR_A.toLowerCase());
  });

  it('fails closed for undeclared role', () => {
    expect(registry.hasAddress('pancakeswap', 'quoter')).toBe(false);
    expect(() => registry.requireAddress('pancakeswap', 'quoter')).toThrowError(ErrorCode.CONTRACT_NOT_ALLOWED);
  });

  it('rejects invalid addresses at registration', () => {
    expect(() =>
      new DeploymentRegistry({
        chainId: MAINNET,
        deployments: [{ protocolId: 'bad', chainId: MAINNET, contracts: { router: '0xZZZ' }, verified: true }],
      }),
    ).toThrowError(ErrorCode.SCHEMA_INVALID);
  });
});

describe('ContractRegistry (READ_ONLY vs EXECUTE capability model)', () => {
  const registry = new ContractRegistry({
    chainId: MAINNET,
    contracts: [
      {
        id: 'pcs-router',
        chainId: MAINNET,
        address: ADDR_A,
        protocolId: 'pancakeswap',
        name: 'PancakeSwap Router',
        verified: true,
        enabled: true,
        functions: [
          { signature: 'getAmountsOut(uint256,address[])', name: 'getAmountsOut', capability: 'READ_ONLY' },
          { signature: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', name: 'swapExactTokensForTokens', capability: 'EXECUTE' },
        ],
      },
      {
        id: 'pcs-readonly',
        chainId: MAINNET,
        address: ADDR_B,
        protocolId: 'pancakeswap',
        name: 'Read-Only Contract',
        verified: true,
        enabled: false, // verified but NOT enabled
        functions: [{ signature: 'quote(uint256,uint256,uint256)', name: 'quote', capability: 'READ_ONLY' }],
      },
    ],
  });

  it('allows read on a verified, enabled READ_ONLY function', () => {
    expect(registry.canRead(ADDR_A, 'getAmountsOut')).toBe(true);
    expect(() => registry.requireRead(ADDR_A, 'getAmountsOut')).not.toThrow();
  });

  it('allows EXECUTE on a declared EXECUTE function', () => {
    expect(registry.canExecute(ADDR_A, 'swapExactTokensForTokens')).toBe(true);
    expect(() => registry.requireExecute(ADDR_A, 'swapExactTokensForTokens')).not.toThrow();
  });

  it('denies EXECUTE on a READ_ONLY function', () => {
    expect(registry.canExecute(ADDR_A, 'getAmountsOut')).toBe(false);
    expect(() => registry.requireExecute(ADDR_A, 'getAmountsOut')).toThrowError(/READ_ONLY/);
  });

  it('denies an unregistered contract (fail-closed)', () => {
    expect(registry.isRegistered(ADDR_C)).toBe(false);
    expect(() => registry.requireRead(ADDR_C, 'quote')).toThrowError(/not registered/);
  });

  it('denies a contract that is verified but not enabled (verified ≠ enabled)', () => {
    expect(registry.canRead(ADDR_B, 'quote')).toBe(false);
    expect(() => registry.requireRead(ADDR_B, 'quote')).toThrowError(/not enabled/);
  });
});

describe('AbiRegistry (verified ABI fragments)', () => {
  const registry = new AbiRegistry({
    chainId: MAINNET,
    abis: [
      {
        address: ADDR_A,
        chainId: MAINNET,
        functions: [
          { type: 'function', name: 'getAmountsOut', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
          { type: 'function', name: 'swapExactTokensForTokens', stateMutability: 'nonpayable', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [{ name: 'amounts', type: 'uint256[]' }] },
        ],
      },
    ],
  });

  it('resolves a verified function fragment', () => {
    const fn = registry.requireFunction(ADDR_A, 'getAmountsOut');
    expect(fn.stateMutability).toBe('view');
  });

  it('fails closed on undeclared function', () => {
    expect(registry.hasFunction(ADDR_A, 'nope')).toBe(false);
    expect(() => registry.requireFunction(ADDR_A, 'nope')).toThrowError(ErrorCode.FUNCTION_NOT_ALLOWED);
  });

  it('fails closed on unknown contract', () => {
    expect(() => registry.requireFunction(ADDR_C, 'getAmountsOut')).toThrowError(ErrorCode.CONTRACT_NOT_ALLOWED);
  });
});