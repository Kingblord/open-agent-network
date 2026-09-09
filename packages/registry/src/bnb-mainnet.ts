/**
 * BNB mainnet (chain 56) registry seeds — mustflow §5/§10–13.
 *
 * The BAN execution chain default is BNB mainnet (56). These are the seed
 * records for the Token / Protocol / Deployment registries that the control
 * plane uses to RESOLVE user choices into registry entries:
 *
 *   - Tokens (BNB native / WBNB / USDT / USDC) → verified AND enabled
 *     (P0 activation, 2026-08-28). "verified ≠ enabled" (mustflow §12) still
 *     holds as the general rule; the activation below is the explicit ops
 *     step that deliberately opened the P0 core assets for autonomous
 *     execution. Anything outside this P0 set remains verified-only.
 *   - Protocols → the SMALL, verified BSC set BAN starts with (hackathon
 *     scope): P0 = PancakeSwap + Venus (EXECUTION-ENABLED), P1 =
 *     Aave V3 + Lista DAO + THENA (selection only), P2 = Wombat + Aspan,
 *     P3 = Stargate (DISCOVERY_ONLY — cross-chain is out of BAN's first
 *     mainnet loop). `priority` is roadmap info only, never authority.
 *   - Deployments → per-protocol role→address seeds. PancakeSwap router is
 *     sourced from PancakeSwap's official SDK constant
 *     (SMART_ROUTER_ADDRESSES[ChainId.BSC]); Venus carries the Core Pool
 *     Comptroller + Oracle + vTokens; Aave V3 Pool from the typed
 *     address-book. The P0 deployments and Aave V3 Pool are `verified: true`
 *     (on-chain confirmed 2026-08-28). Aave V3 Pool is recognized for
 *     selection only — it has NO registered ContractRegistry record and is
 *     therefore NOT executable (fail-closed). PancakeSwap + Venus records are
 *     deliberately `enabled: true` (activation, see bnb-contracts.ts).
 *
 * Execution authority lives in ContractRegistry (enabled + func capability).
 * Only the P0 set was deliberately activated 2026-08-28; everything else is
 * DENIED by default.
 */

import { DeploymentRecord } from './deployment-registry.js';
import { DeploymentRegistry } from './deployment-registry.js';
import { ProtocolRecord } from './protocol-registry.js';
import { ProtocolRegistry } from './protocol-registry.js';
import { TokenRecord } from './token-registry.js';
import { TokenRegistry } from './token-registry.js';
import {
  PANCAKE_SWAP_ROUTER,
  VENUS_COMPTROLLER,
  VENUS_ORACLE,
  VENUS_VTOKENS,
} from './bnb-contracts.js';

/** BAN execution chain (BNB Smart Chain mainnet). */
export const BNB_CHAIN_ID = 56;

/**
 * BNB mainnet tokens (Binance-Peg). Core assets (BNB/WBNB/USDT/USDC) are
 * `verified: true` AND `enabled: true` — deliberately opened for autonomous
 * execution by the P0 activation (2026-08-28). TOKEN_OPTIONS in the web
 * session modal mirrors these symbols + native BNB.
 */
export const BNB_MAINNET_TOKENS: TokenRecord[] = [
  {
    id: 'bnb',
    chainId: 56,
    // Native gas token — no ERC-20 contract; address is the canonical
    // zero-address sentinel used for routing BNB (WBNB is the wrapped form).
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'BNB',
    name: 'BNB (native)',
    decimals: 18,
    verified: true,
    enabled: true,
    native: true,
  },
  {
    id: 'wbnb',
    chainId: 56,
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    decimals: 18,
    verified: true,
    enabled: true,
    native: true,
  },
  {
    id: 'usdt',
    chainId: 56,
    address: '0x55d398326f99059fF775485246999027B3197955',
    symbol: 'USDT',
    name: 'Binance-Peg BSC-USD',
    decimals: 18,
    verified: true,
    enabled: true,
  },
  {
    id: 'usdc',
    chainId: 56,
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    symbol: 'USDC',
    name: 'Binance-Peg USD Coin',
    decimals: 18,
    verified: true,
    enabled: true,
  },
];

/**
 * ACTIVE protocols for BAN selection (mustflow §13). Priority is ROADMAP/
 * DISCOVERY ONLY (mustflow §13.5) — it does NOT grant execution authority.
 *
 * Hackathon scope (small, verified BSC set):
 *   P0 PancakeSwap (Swap+LP+Grid) · Venus (Health+Yield)   ← EXECUTION-ENABLED (activation 2026-08-28)
 *   P1 Aave V3 (Lending Yield/Health) · Lista DAO (BNB yield) · THENA (DEX/LP)  ← selection only
 *   P2 Wombat (Stablecoin liquidity) · Aspan (BNB yield)
 *   P3 Stargate (cross-chain REACH only — DISCOVERY_ONLY, no BAN strategy yet)
 */
export const BNB_MAINNET_PROTOCOLS: ProtocolRecord[] = [
  { id: 'pancakeswap', chainId: 56, name: 'PancakeSwap', status: 'ACTIVE', official: true, priority: 'P0' },
  { id: 'venus', chainId: 56, name: 'Venus', status: 'ACTIVE', official: true, priority: 'P0' },
  { id: 'aave', chainId: 56, name: 'Aave V3', status: 'ACTIVE', official: true, priority: 'P1' },
  { id: 'lista', chainId: 56, name: 'Lista DAO', status: 'ACTIVE', official: true, priority: 'P1' },
  { id: 'thena', chainId: 56, name: 'THENA', status: 'ACTIVE', official: true, priority: 'P1' },
  { id: 'wombat', chainId: 56, name: 'Wombat', status: 'ACTIVE', official: true, priority: 'P2' },
  { id: 'aspan', chainId: 56, name: 'Aspan', status: 'ACTIVE', official: true, priority: 'P2' },
  { id: 'stargate', chainId: 56, name: 'Stargate', status: 'DISCOVERY_ONLY', official: false, priority: 'P3' },
];

/**
 * Registered deployment addresses (protocol role → address).
 * `verified: true` for the P0 set + Aave V3 Pool — confirmed on-chain by the
 * verification pipeline (getCode, BSC mainnet, 2026-08-28). PancakeSwap +
 * Venus are ALSO activated for execution (enabled:true, bnb-contracts.ts);
 * Aave V3 Pool has no registered ContractRegistry record → recognized for
 * selection/display, NEVER executable (mustflow §10/§12). The PancakeSwap
 * router address is sourced from PancakeSwap's official SDK constant
 * (SMART_ROUTER_ADDRESSES[ChainId.BSC]); Venus Core Pool map (Comptroller +
 * Oracle + vTokens) from the official deployment list; Aave V3 Pool from
 * @bgd-labs/aave-address-book; Lista / THENA / Wombat / Aspan ship with EMPTY
 * (or candidate-only) maps pending the verification pipeline — never guessed
 * from secondary sources.
 */
export const BNB_MAINNET_DEPLOYMENTS: DeploymentRecord[] = [
  {
    protocolId: 'pancakeswap',
    chainId: 56,
    contracts: {
      // PancakeSwap V3 Smart Router — verified-known BSC mainnet address
      // (synced from @pancakeswap/smart-router SMART_ROUTER_ADDRESSES[BSC]
      // in bnb-contracts.ts; the canonical alias `router` is what the live
      // swap adapter's requireDeploy('pancakeswap','router') resolves).
      v3SwapRouter: PANCAKE_SWAP_ROUTER,
      router: PANCAKE_SWAP_ROUTER,
      // PancakeSwap V3 NonfungiblePositionManager (NFPM) — the LP position
      // NFT manager. Source: official pancake-v3-contracts deployment
      // manifest (bscMainnet.json → NonfungiblePositionManager).
      // Verified on-chain 2026-09-09: 24.4KB runtime code on BSC mainnet,
      // implements ERC-721 position reads (balanceOf / tokenOfOwnerByIndex /
      // positions / totalSupply) + the LP liquidity periphery surface the
      // strategy-lp + live-provider getPoolPosition adapter consume.
      positionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
    },
    verified: true, // code confirmed on BSC mainnet (getCode) 2026-08-28; NFPM 2026-09-09.
  },
  {
    protocolId: 'venus',
    chainId: 56,
    contracts: {
      comptroller: VENUS_COMPTROLLER,
      oracle: VENUS_ORACLE,
      ...VENUS_VTOKENS,
    },
    verified: true, // comptroller/oracle/vBNB/vUSDT/vUSDC/vETH/vBTC confirmed on-chain 2026-08-28. vBUSD removed (no bytecode — market retired).
  },
  {
    protocolId: 'aave',
    chainId: 56,
    // Aave V3 Pool (BNB mainnet) — canonical address from the typed Aave
    // address-book package `AaveV3BNB.POOL` (v4.44.x, CHAIN_ID 56).
    // verified:true — on-chain confirmed by the pipeline 2026-08-28; NO
    // ContractRegistry record exists for it, so it is recognized for
    // selection/display but NEVER executable.
    contracts: {
      v3Pool: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
    },
    verified: true, // code confirmed on BSC mainnet (getCode) 2026-08-28.
  },
  {
    protocolId: 'lista',
    chainId: 56,
    // Lista DAO role addresses must be confirmed from Lista DAO docs /
    // deployment JSON via the verification pipeline before use. EMPTY map +
    // verified:false = recognized, never executable.
    contracts: {},
    verified: false,
  },
  {
    protocolId: 'thena',
    chainId: 56,
    // THENA (DEX/LP, P1) — deployment JSON pending verification pipeline.
    contracts: {},
    verified: false,
  },
  {
    protocolId: 'wombat',
    chainId: 56,
    // Wombat (stablecoin liquidity, P2) — deployment JSON pending verification.
    contracts: {},
    verified: false,
  },
  {
    protocolId: 'aspan',
    chainId: 56,
    // Aspan (BNB yield, P2) — deployment JSON pending verification.
    contracts: {},
    verified: false,
  },
  {
    protocolId: 'stargate',
    chainId: 56,
    // Stargate (cross-chain, P3) — DISCOVERY_ONLY until a cross-chain strategy
    // exists. contracts: {} → fail-closed, never executable.
    contracts: {},
    verified: false,
  },
];

/** Instantiate the three registries for the BAN execution chain. */
export function createBnbRegistries(chainId: number = BNB_CHAIN_ID) {
  return {
    tokens: new TokenRegistry({ chainId, tokens: BNB_MAINNET_TOKENS }),
    protocols: new ProtocolRegistry({ chainId, protocols: BNB_MAINNET_PROTOCOLS }),
    deployments: new DeploymentRegistry({ chainId, deployments: BNB_MAINNET_DEPLOYMENTS }),
  };
}