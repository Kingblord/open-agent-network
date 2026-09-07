import { describe, it, expect } from 'vitest';
import { decodeFunctionData, parseAbi } from 'viem';
import { buildVenusCalls, buildAaveCalls } from '../lib/execution/lending';

/**
 * Lending calldata builders — the real-funds execution surface for the health
 * and yield strategies. These tests decode the built calldata back and assert
 * the EXACT selector/args the chain will see, so a regression in the builder
 * can never silently send a wrong call to a verified contract.
 */

const ERC20_ABI = parseAbi(['function approve(address spender, uint256 value) returns (bool)']);
const VENUS_ABI = parseAbi([
  'function mint(uint mintAmount) returns (uint)',
  'function mint() payable',
  'function redeemUnderlying(uint redeemAmount) returns (uint)',
  'function repayBorrow(uint repayAmount) returns (uint)',
]);
const AAVE_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
]);

const V_TOKEN = '0xfD5840Cd36d94D7229439859C0112a4185BC0255' as const; // vUSDT
const USDT = '0x55d398326f99059fF775485246999027B3197955' as const;
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as const;
const V_BNB = '0xA07c5b74C9B40447a954e1466938b865b6BBea36' as const;
const AAVE_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB' as const;
const WALLET = '0x1111111111111111111111111111111111111111' as const;
const AMOUNT = 5_000_000_000_000_000_000_000n; // 5000e18

describe('buildVenusCalls', () => {
  it('DEPOSIT (ERC-20) = approve(vToken, amount) + mint(amount)', () => {
    const calls = buildVenusCalls({
      target: V_TOKEN, underlying: USDT, amount: AMOUNT, wallet: WALLET, intent: 'DEPOSIT',
    });
    expect(calls.length).toBe(2);
    expect(calls[0].to).toBe(USDT);
    expect(calls[0].value).toBe(0n);
    const approve = decodeFunctionData({ abi: ERC20_ABI, data: calls[0].data });
    expect(approve.functionName).toBe('approve');
    expect(approve.args).toEqual([V_TOKEN, AMOUNT]);
    expect(calls[1].to).toBe(V_TOKEN);
    const mint = decodeFunctionData({ abi: VENUS_ABI, data: calls[1].data });
    expect(mint.functionName).toBe('mint');
    expect(mint.args).toEqual([AMOUNT]);
  });

  it('DEPOSIT (native BNB) = payable mint() with msg.value (no approve)', () => {
    const calls = buildVenusCalls({
      target: V_BNB, underlying: '0x0000000000000000000000000000000000000000', amount: AMOUNT, wallet: WALLET, intent: 'DEPOSIT',
    });
    expect(calls.length).toBe(1);
    expect(calls[0].to).toBe(V_BNB);
    expect(calls[0].value).toBe(AMOUNT);
    const mint = decodeFunctionData({ abi: VENUS_ABI, data: calls[0].data });
    expect(mint.functionName).toBe('mint');
    expect(mint.args ?? []).toEqual([]);
  });

  it('REPAY = approve + repayBorrow', () => {
    const calls = buildVenusCalls({
      target: V_TOKEN, underlying: USDT, amount: AMOUNT, wallet: WALLET, intent: 'REPAY',
    });
    expect(calls.length).toBe(2);
    const repay = decodeFunctionData({ abi: VENUS_ABI, data: calls[1].data });
    expect(repay.functionName).toBe('repayBorrow');
    expect(repay.args).toEqual([AMOUNT]);
  });

  it('WITHDRAW = redeemUnderlying only (no approve)', () => {
    const calls = buildVenusCalls({
      target: V_TOKEN, underlying: USDT, amount: AMOUNT, wallet: WALLET, intent: 'WITHDRAW',
    });
    expect(calls.length).toBe(1);
    const redeem = decodeFunctionData({ abi: VENUS_ABI, data: calls[0].data });
    expect(redeem.functionName).toBe('redeemUnderlying');
    expect(redeem.args).toEqual([AMOUNT]);
  });

  it('refuses zero/negative amounts (fail-closed)', () => {
    expect(() => buildVenusCalls({
      target: V_TOKEN, underlying: USDT, amount: 0n, wallet: WALLET, intent: 'DEPOSIT',
    })).toThrow();
  });
});

describe('buildAaveCalls', () => {
  it('DEPOSIT = approve(pool, amount) + supply(asset, amount, wallet, 0)', () => {
    const calls = buildAaveCalls({
      target: AAVE_POOL, underlying: USDT, amount: AMOUNT, wallet: WALLET, intent: 'DEPOSIT',
    });
    expect(calls.length).toBe(2);
    const supply = decodeFunctionData({ abi: AAVE_ABI, data: calls[1].data });
    expect(supply.functionName).toBe('supply');
    expect(supply.args).toEqual([USDT, AMOUNT, WALLET, 0]);
  });

  it('WITHDRAW = withdraw(asset, amount, wallet) only', () => {
    const calls = buildAaveCalls({
      target: AAVE_POOL, underlying: USDT, amount: AMOUNT, wallet: WALLET, intent: 'WITHDRAW',
    });
    expect(calls.length).toBe(1);
    const withdraw = decodeFunctionData({ abi: AAVE_ABI, data: calls[0].data });
    expect(withdraw.functionName).toBe('withdraw');
    expect(withdraw.args).toEqual([USDT, AMOUNT, WALLET]);
  });
});
