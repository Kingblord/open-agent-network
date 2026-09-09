import type { ActionProposal, Observation } from '@ban/schemas';
/**
 * Canonicalize a yield proposal:
 *  - action → DEPOSIT (invest) / WITHDRAW (harvest); directive → null
 *  - contract/function → resolved from the OBSERVED candidate's protocol+asset
 *  - amount → sanitized integer wei (never a float the policy BigInt would
 *    crash on)
 *  - params.execKind marks the execution surface the signer expects
 * Returns null when no candidate/protocol/asset resolves deterministically.
 *
 * USER-WALLET-AWARE EXECUTION (parity with the health strategy): a deposit of
 * the USER's capital must land ON THE USER's position — the agent wallet pays,
 * the USER receives the vTokens/aTokens (mintBehalf / supply onBehalfOf).
 * Pass the resolved owner wallet (run-cycle threads it via strategy config
 * `userWalletAddress`, mirroring health). When absent, the deposit targets the
 * agent's OWN position (prior behavior). WITHDRAW stays agent-owned: the
 * deployed Venus vTokens expose NO redeemUnderlyingBehalf path (verified
 * on-chain — "not an approved delegate"), so a harvest only works on a
 * position the agent itself can redeem.
 */
export declare function canonicalizeYieldProposal(proposal: ActionProposal, observation: Observation, userWalletAddress?: string | null, depositUsdCents?: number | null): ActionProposal | null;
//# sourceMappingURL=canonical-proposal.d.ts.map