/**
 * BNB mainnet (chain 56) CONTRACT + ABI seeds — mustflow §10, §12–§14.
 *
 * This is the small, verified BSC protocol set BAN starts with (hackathon
 * scope: P0 = PancakeSwap + Venus + core tokens). It maps the full chain the
 * admin page surfaces:
 *
 *   protocol → deployment (address) → contract → capability → ABI
 *
 * Security invariants (identical to bnb-mainnet.ts):
 *   - verified ≠ enabled (mustflow §12). `verified` = recognized/real
 *     (on-chain existence confirmed by the verification pipeline);
 *     `enabled` = allowed for autonomous execution.
 *   - `verified: true` on the P0 records below: on-chain existence confirmed
 *     by the verification pipeline (getCode, BSC mainnet, 2026-08-28).
 *   - ACTIVATION (2026-08-28, explicit ops step #1): the verified P0 set was
 *     deliberately opened for autonomous execution — `enabled: true` on
 *     PancakeSwap V3 Smart Router (SWAP), Venus Comptroller + Oracle +
 *     vTokens (LENDING/HEALTH/YIELD), and the core tokens BNB/WBNB/USDT/USDC
 *     (bnb-mainnet.ts). This is the explicit activation step that MUST be
 *     intentional, never seeded automatically.
 *   - Every function has a declared capability (READ_ONLY vs EXECUTE).
 *     Fail-closed: `canRead`/`canExecute`/`requireExecute` deny everything
 *     until verified AND enabled AND chain matches; READ_ONLY functions are
 *     never executable entry points.
 *   - Everything else (Aave V3 / Lista / THENA / Wombat / Aspan / Stargate)
 *     is NOT registered here → DENIED (fail-closed, mustflow §10/§13).
 *
 * P0 set (hackathon):
 *   - PancakeSwap: V3 SmartRouter (swap/LP/grid + yield via pools)
 *   - Venus: Comptroller + Oracle + Core Pool vTokens (vBNB/vUSDT/vUSDC/
 *     vETH/vBTC) — health-factor + lending yield
 *   - Core assets: BNB native / WBNB / USDT / USDC (tokens in bnb-mainnet.ts)
 *
 * Promotion record (2026-08-28 — `pnpm --filter @ban/registry run verify:seeds`):
 *   - vBUSD (0x95c78222B3D6e262dCeD22886E1D4A6f52e70008) returned codeLen=0 in
 *     two independent getCode checks (BSC mainnet; vUSDC read 9490 bytes on the
 *     same query) — Venus retired the BUSD market. REMOVED from VENUS_VTOKENS
 *     so it is never offered as a selectable market. Re-added only via pipeline.
 */

import { ContractRecord } from './contract-registry.js';
import { ContractAbiRecord } from './abi-registry.js';

/** PancakeSwap V3 SmartRouter (BSC mainnet) — swap + routing. */
export const PANCAKE_SWAP_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4';
/** Venus Core Pool Comptroller (BSC mainnet). */
export const VENUS_COMPTROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';
/** Venus Oracle (BSC mainnet Core Pool). */
export const VENUS_ORACLE = '0xd8B6dA2bfEC71D684D3E2a2FC9492dDad5C3787F';

/** Venus Core Pool vTokens (well-known BSC mainnet addresses, official list). */
export const VENUS_VTOKENS = {
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
} as const;

export const PANCAKE_ROUTER_FUNCTIONS: ContractRecord['functions'] = [
  {
    signature: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
    name: 'exactInputSingle',
    capability: 'EXECUTE',
  },
  {
    signature: 'exactInput((bytes,address,uint256,uint256,uint256))',
    name: 'exactInput',
    capability: 'EXECUTE',
  },
  {
    signature: 'quoteExactInputSingle((address,address,uint24,uint256,uint160))',
    name: 'quoteExactInputSingle',
    capability: 'READ_ONLY',
  },
];

export const VENUS_COMPTROLLER_FUNCTIONS: ContractRecord['functions'] = [
  {
    signature: 'getAccountLiquidity(address)',
    name: 'getAccountLiquidity',
    capability: 'READ_ONLY',
  },
  {
    signature: 'enterMarkets(address[])',
    name: 'enterMarkets',
    capability: 'EXECUTE',
  },
  {
    signature: 'exitMarket(address)',
    name: 'exitMarket',
    capability: 'EXECUTE',
  },
];

export const VENUS_ORACLE_FUNCTIONS: ContractRecord['functions'] = [
  {
    signature: 'getUnderlyingPrice(address)',
    name: 'getUnderlyingPrice',
    capability: 'READ_ONLY',
  },
];

/** Venus vToken read functions shared by every Core Pool market. */
export const VTOKEN_READ_FUNCTIONS: ContractRecord['functions'] = [
  {
    signature: 'balanceOf(address)',
    name: 'balanceOf',
    capability: 'READ_ONLY',
  },
  {
    signature: 'balanceOfUnderlying(address)',
    name: 'balanceOfUnderlying',
    capability: 'READ_ONLY',
  },
  {
    signature: 'borrowBalanceCurrent(address)',
    name: 'borrowBalanceCurrent',
    capability: 'READ_ONLY',
  },
];

/** Venus vToken write functions (declared EXECUTE, enabled by the P0 activation). */
export const VTOKEN_EXECUTE_FUNCTIONS: ContractRecord['functions'] = [
  {
    signature: 'mint(uint256)',
    name: 'mint',
    capability: 'EXECUTE',
  },
  {
    signature: 'redeem(uint256)',
    name: 'redeem',
    capability: 'EXECUTE',
  },
  {
    signature: 'borrow(uint256)',
    name: 'borrow',
    capability: 'EXECUTE',
  },
  {
    signature: 'repayBorrow(uint256)',
    name: 'repayBorrow',
    capability: 'EXECUTE',
  },
];

/**
 * Registered contract records for the BAN chain. P0 records below are
 * `verified: true` (on-chain confirmed 2026-08-28) and `enabled: true`
 * (deliberate activation 2026-08-28, ops step #1 — autonomous execution is
 * OPEN for this exact P0 set). Everything else stays unregistered → DENIED.
 */
export const BNB_MAINNET_CONTRACTS: ContractRecord[] = [
  {
    id: 'pancakeswap-v3-swap-router',
    chainId: 56,
    address: PANCAKE_SWAP_ROUTER,
    protocolId: 'pancakeswap',
    name: 'PancakeSwap V3 Smart Router',
    verified: true,
    enabled: true,
    functions: PANCAKE_ROUTER_FUNCTIONS,
    capabilities: ['SWAP', 'LP'],
    abiVersion: 'v3',
    source: ['pancakeswap/deployments/bscMainnet.json'],
  },
  {
    id: 'venus-comptroller',
    chainId: 56,
    address: VENUS_COMPTROLLER,
    protocolId: 'venus',
    name: 'Venus Core Pool Comptroller',
    verified: true,
    enabled: true,
    functions: VENUS_COMPTROLLER_FUNCTIONS,
    capabilities: ['LENDING'],
    abiVersion: 'comptroller-v2',
    source: ['venus-protocol/deployments/bscmainnet'],
  },
  {
    id: 'venus-oracle',
    chainId: 56,
    address: VENUS_ORACLE,
    protocolId: 'venus',
    name: 'Venus Oracle',
    verified: true,
    enabled: true,
    functions: VENUS_ORACLE_FUNCTIONS,
    capabilities: ['PRICE', 'LENDING'],
    abiVersion: 'oracle-v2',
    source: ['venus-protocol/deployments/bscmainnet'],
  },
  ...Object.entries(VENUS_VTOKENS).map(([symbol, address]) => ({
    id: `venus-vtoken-${symbol.toLowerCase()}`,
    chainId: 56,
    address,
    protocolId: 'venus',
    name: `Venus ${symbol} (Core Pool vToken)`,
    verified: true,
    enabled: true,
    functions: [...VTOKEN_READ_FUNCTIONS, ...VTOKEN_EXECUTE_FUNCTIONS],
    capabilities: ['LENDING', 'YIELD'],
    abiVersion: 'vtoken-v2',
    source: ['venus-protocol/deployments/bscmainnet'],
  })) as ContractRecord[],
];

/**
 * Verified ABI fragments for the P0 contracts (mustflow §10). AbiRegistry is
 * NOT the authority — ContractRegistry records are. These give the signer/
 * execution path canonical encodings WITHOUT accepting AI/frontend ABIs.
 * Fail-closed: any function not declared here is UNDECLARED → denied.
 */
export const BNB_MAINNET_ABI_SEEDS: ContractAbiRecord[] = [
  {
    address: PANCAKE_SWAP_ROUTER,
    chainId: 56,
    functions: [
      {
        type: 'function',
        name: 'exactInputSingle',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'params', type: 'tuple' },
        ],
        outputs: [{ name: 'amountOut', type: 'uint256' }],
      },
      {
        type: 'function',
        name: 'quoteExactInputSingle',
        stateMutability: 'view',
        inputs: [
          { name: 'params', type: 'tuple' },
        ],
        outputs: [{ name: 'amountOut', type: 'uint256' }],
      },
    ],
  },
  {
    address: VENUS_COMPTROLLER,
    chainId: 56,
    functions: [
      {
        type: 'function',
        name: 'getAccountLiquidity',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [
          { name: 'error', type: 'uint256' },
          { name: 'liquidity', type: 'uint256' },
          { name: 'shortfall', type: 'uint256' },
        ],
      },
      {
        type: 'function',
        name: 'enterMarkets',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'vTokens', type: 'address[]' }],
        outputs: [{ name: '', type: 'uint256[]' }],
      },
    ],
  },
  {
    address: VENUS_ORACLE,
    chainId: 56,
    functions: [
      {
        type: 'function',
        name: 'getUnderlyingPrice',
        stateMutability: 'view',
        inputs: [{ name: 'vToken', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ],
  },
  ...Object.values(VENUS_VTOKENS).map((address) => ({
    address,
    chainId: 56,
    functions: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
      {
        type: 'function',
        name: 'balanceOfUnderlying',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
      {
        type: 'function',
        name: 'borrowBalanceCurrent',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as ContractAbiRecord['functions'],
  })) as ContractAbiRecord[],
];