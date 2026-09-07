import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { BANError, ErrorCode } from '@ban/shared';

/**
 * Deterministic lending calldata builders for strategy-authored lending
 * proposals (real-funds safety): Venus Core Pool vTokens and Aave V3.
 *
 * Every call is constructed from DETERMINISTIC proposal fields (contract,
 * function, token, integer-wei amount) — never from LLM free text. ERC-20
 * spends are batched behind an exact-amount approve (no standing allowance).
 * Native-BNB supply goes straight to the vBNB mint() payable with msg.value.
 *
 * Pure module: no network, no state — fully unit-testable.
 */

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value) returns (bool)',
]);

// Venus Core Pool vToken ABI (subset used by the health/yield strategies).
const VENUS_VTOKEN_ABI = parseAbi([
  'function mint(uint mintAmount) returns (uint)',
  'function mint() payable', // vBNB native supply
  'function redeemUnderlying(uint redeemAmount) returns (uint)',
  'function repayBorrow(uint repayAmount) returns (uint)',
]);

// Aave V3 Pool ABI (subset).
const AAVE_POOL_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
]);

/** BSC mainnet WBNB (used for native-BNB supply through vBNB). */
const BSC_WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface ExecutableCall {
  to: Address;
  data: `0x${string}`;
  value: bigint;
}

export interface LendingCallParams {
  /** Contract being called: Venus vToken or Aave V3 pool. */
  target: Address;
  /** Underlying ERC-20 being deposited/repaid (zero address for native BNB). */
  underlying: Address;
  /** Integer wei amount (18 decimals). */
  amount: bigint;
  /** The agent wallet (recipient / onBehalfOf). */
  wallet: Address;
  /** DEPOSIT (supply/mint) or WITHDRAW (redeem/withdraw) or REPAY. */
  intent: 'DEPOSIT' | 'WITHDRAW' | 'REPAY';
}

function assertAmount(amount: bigint): void {
  if (amount <= 0n) {
    throw new BANError(
      ErrorCode.VALIDATION_FAILED,
      'Lending amount must be positive',
      { retryable: false },
    );
  }
}

/**
 * Build Venus Core Pool calls for a lending intent.
 *  - DEPOSIT (ERC-20): [approve(vToken, amount), mint(amount)]
 *  - DEPOSIT (native BNB): [mint() payable with msg.value = amount]
 *  - REPAY (ERC-20):      [approve(vToken, amount), repayBorrow(amount)]
 *  - WITHDRAW:            [redeemUnderlying(amount)]
 */
export function buildVenusCalls(params: LendingCallParams): ExecutableCall[] {
  assertAmount(params.amount);
  const isNative = params.underlying === ZERO_ADDRESS || params.underlying === BSC_WBNB
    ? params.underlying === ZERO_ADDRESS // WBNB is an ERC-20; only native BNB skips approve
    : false;

  if (params.intent === 'WITHDRAW') {
    return [
      {
        to: params.target,
        data: encodeFunctionData({
          abi: VENUS_VTOKEN_ABI,
          functionName: 'redeemUnderlying',
          args: [params.amount],
        }),
        value: 0n,
      },
    ];
  }

  if (isNative) {
    return [
      {
        to: params.target,
        data: encodeFunctionData({ abi: VENUS_VTOKEN_ABI, functionName: 'mint' }),
        value: params.amount,
      },
    ];
  }

  const approve = {
    to: params.underlying,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [params.target, params.amount],
    }),
    value: 0n,
  };
  if (params.intent === 'REPAY') {
    return [
      approve,
      {
        to: params.target,
        data: encodeFunctionData({
          abi: VENUS_VTOKEN_ABI,
          functionName: 'repayBorrow',
          args: [params.amount],
        }),
        value: 0n,
      },
    ];
  }
  return [
    approve,
    {
      to: params.target,
      data: encodeFunctionData({
        abi: VENUS_VTOKEN_ABI,
        functionName: 'mint',
        args: [params.amount],
      }),
      value: 0n,
    },
  ];
}

/**
 * Build Aave V3 Pool calls for a lending intent.
 *  - DEPOSIT: [approve(pool, amount), supply(asset, amount, wallet, 0)]
 *  - WITHDRAW: [withdraw(asset, amount, wallet)]
 */
export function buildAaveCalls(params: LendingCallParams): ExecutableCall[] {
  assertAmount(params.amount);
  if (params.intent === 'WITHDRAW') {
    return [
      {
        to: params.target,
        data: encodeFunctionData({
          abi: AAVE_POOL_ABI,
          functionName: 'withdraw',
          args: [params.underlying, params.amount, params.wallet],
        }),
        value: 0n,
      },
    ];
  }
  return [
    {
      to: params.underlying,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [params.target, params.amount],
      }),
      value: 0n,
    },
    {
      to: params.target,
      data: encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [params.underlying, params.amount, params.wallet, 0],
      }),
      value: 0n,
    },
  ];
}
