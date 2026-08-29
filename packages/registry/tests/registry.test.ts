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
  createBnbRegistries,
  BNB_MAINNET_CONTRACTS,
  BNB_MAINNET_TOKENS,
  PANCAKE_SWAP_ROUTER,
  VENUS_COMPTROLLER,
  VENUS_ORACLE,
  VENUS_VTOKENS,
} from '../src/index.js';
import { BANError, ErrorCode } from '@ban/shared';

const MAINNET = 56;
const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const ADDR_C = '0x3333333333333333333333333333333333333333';

/** Assert a thrown BANError carries the exact ErrorCode (not the message). */
function throwsCode(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
  } catch (err) {
    expect((err as BANError).code).toBe(code);
    return;
  }
  throw new Error(`expected function to throw BANError ${code}, but it did not throw`);
}

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
    throwsCode(() => registry.requireEnabled('NOPE'), ErrorCode.TOKEN_NOT_ALLOWED);
  });

  it('denies a verified but NOT enabled token (verified ≠ enabled)', () => {
    expect(registry.isEnabled('USDT')).toBe(false);
    expect(() => registry.requireEnabled('USDT')).toThrowError(/not enabled/);
  });

  it('denies an address actually on testnet (97) since BAN execution chain is 56', () => {
    throwsCode(
      () =>
        new TokenRegistry({
          chainId: MAINNET,
          tokens: [{ id: 'bad', chainId: 97, address: ADDR_C, symbol: 'BAD', name: 'Bad', decimals: 18, verified: true, enabled: true }],
        }),
      ErrorCode.TOKEN_NOT_ALLOWED,
    );
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
    throwsCode(() => registry.requireAddress('pancakeswap', 'quoter'), ErrorCode.CONTRACT_NOT_ALLOWED);
  });

  it('rejects invalid addresses at registration', () => {
    throwsCode(
      () =>
        new DeploymentRegistry({
          chainId: MAINNET,
          deployments: [{ protocolId: 'bad', chainId: MAINNET, contracts: { router: '0xZZZ' }, verified: true }],
        }),
      ErrorCode.SCHEMA_INVALID,
    );
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
    throwsCode(() => registry.requireRead(ADDR_C, 'quote'), ErrorCode.CONTRACT_NOT_ALLOWED);
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
    throwsCode(() => registry.requireFunction(ADDR_A, 'nope'), ErrorCode.FUNCTION_NOT_ALLOWED);
  });

  it('fails closed on unknown contract', () => {
    throwsCode(() => registry.requireFunction(ADDR_C, 'getAmountsOut'), ErrorCode.CONTRACT_NOT_ALLOWED);
  });
});

describe('BAN P0 activation — execution authority (mustflow §12/§14)', () => {
  const { tokens, protocols, deployments } = createBnbRegistries();
  const contracts = new ContractRegistry({ chainId: MAINNET, contracts: BNB_MAINNET_CONTRACTS });

  it('activates the P0 core tokens for autonomous use (BNB/WBNB/USDT/USDC)', () => {
    for (const sym of ['BNB', 'WBNB', 'USDT', 'USDC']) {
      expect(tokens.isEnabled(sym)).toBe(true);
      expect(() => tokens.requireEnabled(sym)).not.toThrow();
    }
    // BNB_MAINNET_TOKENS seeds are reflected by createBnbRegistries.
    expect(BNB_MAINNET_TOKENS.filter((t) => t.enabled).map((t) => t.symbol)).toEqual(['BNB', 'WBNB', 'USDT', 'USDC']);
  });

  it('P0 protocols are ACTIVE and deployments verified', () => {
    expect(protocols.isActive('pancakeswap')).toBe(true);
    expect(protocols.isActive('venus')).toBe(true);
    expect(deployments.hasAddress('pancakeswap', 'router')).toBe(true);
    expect(deployments.hasAddress('venus', 'comptroller')).toBe(true);
  });

  it('PancakeSwap V3 router: EXECUTE authorized for exactInputSingle/exactInput; quote is READ_ONLY', () => {
    expect(contracts.canExecute(PANCAKE_SWAP_ROUTER, 'exactInputSingle')).toBe(true);
    expect(contracts.canExecute(PANCAKE_SWAP_ROUTER, 'exactInput')).toBe(true);
    expect(contracts.canRead(PANCAKE_SWAP_ROUTER, 'quoteExactInputSingle')).toBe(true);
    expect(contracts.canExecute(PANCAKE_SWAP_ROUTER, 'quoteExactInputSingle')).toBe(false);
    expect(() => contracts.requireExecute(PANCAKE_SWAP_ROUTER, 'quoteExactInputSingle')).toThrowError(/READ_ONLY/);
    expect(() => contracts.requireExecute(PANCAKE_SWAP_ROUTER, 'exactInputSingle')).not.toThrow();
  });

  it('Venus Comptroller: EXECUTE for enterMarkets/exitMarket; read for getAccountLiquidity', () => {
    expect(contracts.canRead(VENUS_COMPTROLLER, 'getAccountLiquidity')).toBe(true);
    expect(contracts.canExecute(VENUS_COMPTROLLER, 'enterMarkets')).toBe(true);
    expect(contracts.canExecute(VENUS_COMPTROLLER, 'exitMarket')).toBe(true);
    expect(() => contracts.requireExecute(VENUS_COMPTROLLER, 'enterMarkets')).not.toThrow();
  });

  it('Venus Oracle: read-only getUnderlyingPrice — EXECUTE must be denied', () => {
    expect(contracts.canRead(VENUS_ORACLE, 'getUnderlyingPrice')).toBe(true);
    expect(contracts.canExecute(VENUS_ORACLE, 'getUnderlyingPrice')).toBe(false);
    throwsCode(() => contracts.requireExecute(VENUS_ORACLE, 'getUnderlyingPrice'), ErrorCode.FUNCTION_NOT_ALLOWED);
  });

  it('Venus vTokens: reads + EXECUTE mint/redeem/borrow/repayBorrow all authorized', () => {
    for (const addr of Object.values(VENUS_VTOKENS)) {
      expect(contracts.canRead(addr, 'balanceOfUnderlying')).toBe(true);
      expect(contracts.canRead(addr, 'borrowBalanceCurrent')).toBe(true);
      for (const fn of ['mint', 'redeem', 'borrow', 'repayBorrow']) {
        expect(contracts.canExecute(addr, fn)).toBe(true);
        expect(() => contracts.requireExecute(addr, fn)).not.toThrow();
      }
    }
  });

  it('integration ladder reflects activation: P0 contracts → EXECUTION_ENABLED (oracle SIMULATION)', () => {
    expect(contracts.getIntegrationStatusById('pancakeswap-v3-swap-router').status).toBe('EXECUTION_ENABLED');
    expect(contracts.getIntegrationStatusById('venus-comptroller').status).toBe('EXECUTION_ENABLED');
    // Oracle declares READ_ONLY only → enabled but no EXECUTE capability → SIMULATION.
    expect(contracts.getIntegrationStatusById('venus-oracle').status).toBe('SIMULATION');
    expect(contracts.getIntegrationStatusById('venus-vtoken-vbnb').status).toBe('EXECUTION_ENABLED');
  });

  it('keeps unregistered (non-P0) contracts fail-closed — nothing unrecognized is executable', () => {
    const aavePool = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';
    expect(contracts.isRegistered(aavePool)).toBe(false);
    expect(contracts.canExecute(aavePool, 'supply')).toBe(false);
    throwsCode(() => contracts.requireExecute(aavePool, 'supply'), ErrorCode.CONTRACT_NOT_ALLOWED);
    expect(contracts.getIntegrationStatus(aavePool).status).toBe('DISCOVERY_ONLY');
  });
});