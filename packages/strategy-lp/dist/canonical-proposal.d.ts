import type { ActionProposal, Observation } from '@ban/schemas';
/**
 * Canonicalize an LP proposal:
 *  - action → canonical enum (REMOVE→BURN, CREATE→MINT, REPOSITION→REBALANCE,
 *    directive → null)
 *  - contract → the observed pool address (structurally validated)
 *  - params.execKind = 'PANCAKE_V3_LP' + lpAction + ticks for the executor
 * Returns null when there is no LP candidate or the pool address is not a
 * valid EVM address (honest no-op, never fabricated).
 */
export declare function canonicalizeLpProposal(proposal: ActionProposal, observation: Observation): ActionProposal | null;
//# sourceMappingURL=canonical-proposal.d.ts.map