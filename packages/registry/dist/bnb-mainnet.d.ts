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
/** BAN execution chain (BNB Smart Chain mainnet). */
export declare const BNB_CHAIN_ID = 56;
/**
 * BNB mainnet tokens (Binance-Peg). Core assets (BNB/WBNB/USDT/USDC) are
 * `verified: true` AND `enabled: true` — deliberately opened for autonomous
 * execution by the P0 activation (2026-08-28). TOKEN_OPTIONS in the web
 * session modal mirrors these symbols + native BNB.
 */
export declare const BNB_MAINNET_TOKENS: TokenRecord[];
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
export declare const BNB_MAINNET_PROTOCOLS: ProtocolRecord[];
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
export declare const BNB_MAINNET_DEPLOYMENTS: DeploymentRecord[];
/** Instantiate the three registries for the BAN execution chain. */
export declare function createBnbRegistries(chainId?: number): {
    tokens: TokenRegistry;
    protocols: ProtocolRegistry;
    deployments: DeploymentRegistry;
};
//# sourceMappingURL=bnb-mainnet.d.ts.map