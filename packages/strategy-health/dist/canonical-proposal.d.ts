import type { ActionProposal, Observation } from '@ban/schemas';
/** Venus Core Pool vTokens (verified on-chain 2026-08-28, per @ban/registry). */
export declare const HEALTH_VTOKENS: Record<string, string>;
/**
 * Canonicalize a health proposal:
 *  - action → canonical enum (REPAY/ADD_COLLATERAL → DEPOSIT, directive → null)
 *  - contract → the verified Venus vToken for the asset
 *  - amount → integer wei derived from the candidate's amountCentsUsd
 *  - params.healthAction / params.execKind = 'VENUS_LENDING'
 * Returns null when there is no executable candidate or the protocol/asset
 * cannot be deterministically resolved (honest no-op, never fabricated).
 *
 * USER-WALLET-AWARE EXECUTION (critical correctness fix): the health monitor
 * watches the OWNER's wallet (config.userWalletAddress / watchAddress), so a
 * REPAY must target the OWNER's debt. Venus `repayBorrow(amount)` repays the
 * CALLER's (agent's) debt — which is zero — so the repayment would be a
 * no-op/revert and the user's debt would never be reduced. When the owner's
 * wallet is known, the canonical proposal therefore uses
 * `repayBorrowBehalf(borrower=owner, amount)` (executor pays, owner's debt
 * decreases) and forwards `params.userWalletAddress` so the signer can build
 * the behalf call. ADD_COLLATERAL on the owner's behalf uses `mintBehalf`
 * (agent funds, owner collects the vTokens). Without a known owner wallet the
 * proposal falls back to the agent's own position (prior behavior).
 */
export declare function canonicalizeHealthProposal(proposal: ActionProposal, observation: Observation, userWalletAddress?: string | null): ActionProposal | null;
//# sourceMappingURL=canonical-proposal.d.ts.map