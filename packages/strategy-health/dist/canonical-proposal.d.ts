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
 */
export declare function canonicalizeHealthProposal(proposal: ActionProposal, observation: Observation): ActionProposal | null;
//# sourceMappingURL=canonical-proposal.d.ts.map