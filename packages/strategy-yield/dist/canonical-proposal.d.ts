import type { ActionProposal, Observation } from '@ban/schemas';
/**
 * Canonicalize a yield proposal:
 *  - action → DEPOSIT (invest) / WITHDRAW (harvest); directive → null
 *  - contract/function → resolved from the OBSERVED candidate's protocol+asset
 *  - amount → sanitized integer wei (never a float the policy BigInt would
 *    crash on)
 *  - params.execKind marks the execution surface the signer expects
 * Returns null when no candidate/protocol/asset resolves deterministically.
 */
export declare function canonicalizeYieldProposal(proposal: ActionProposal, observation: Observation): ActionProposal | null;
//# sourceMappingURL=canonical-proposal.d.ts.map