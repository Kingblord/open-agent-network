import { ActionProposalSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { canonicalizeAction, readObservationCandidates, pickCandidate, toWeiIntegerString, isHexAddress, } from '@ban/agent-core';
/**
 * Deterministic canonicalization of LP rebalance proposals (real-funds
 * safety): the brain only chooses REMOVE vs CREATE/REPOSITION (vs PASS). The
 * contract address below comes from the OBSERVED pool (read live by the LP
 * data provider and structurally verified) — never from model-authored text.
 *
 * Execution note: PancakeSwap V3 position ops run through the Nonfungible
 * Position Manager, whose deployment is NOT yet in the verified registry set.
 * The canonical proposal therefore carries `params.execKind =
 * 'PANCAKE_V3_LP'`; the execution layer has no builder for that kind yet and
 * FAILS CLOSED (nothing is broadcast) until the NFPM deployment is verified
 * and the builder ships. Honest "awaiting implementation" beats a fabricated
 * or wrong-contract broadcast.
 */
/** V3 pool entrypoint per LP action. */
const LP_FUNCTIONS = {
    REMOVE: 'decreaseLiquidity',
    CREATE: 'mint',
    REPOSITION: 'mint',
};
/** LP strategy vocabulary → canonical ActionType. */
const LP_ACTION_TO_CANONICAL = {
    REMOVE: 'BURN',
    CREATE: 'MINT',
    REPOSITION: 'REBALANCE',
};
/**
 * Canonicalize an LP proposal:
 *  - action → canonical enum (REMOVE→BURN, CREATE→MINT, REPOSITION→REBALANCE,
 *    directive → null)
 *  - contract → the observed pool address (structurally validated)
 *  - params.execKind = 'PANCAKE_V3_LP' + lpAction + ticks for the executor
 * Returns null when there is no LP candidate or the pool address is not a
 * valid EVM address (honest no-op, never fabricated).
 */
export function canonicalizeLpProposal(proposal, observation) {
    const { directive } = canonicalizeAction(proposal.action);
    if (directive)
        return null;
    const rawAction = typeof proposal.params?.requestedAction === 'string'
        ? proposal.params.requestedAction.toUpperCase()
        : proposal.action.toUpperCase();
    const lpAction = LP_FUNCTIONS[rawAction] ? rawAction : 'REPOSITION';
    const canonical = LP_ACTION_TO_CANONICAL[lpAction];
    const obsData = observation.data ?? {};
    const poolAddress = typeof obsData.poolAddress === 'string' ? obsData.poolAddress : '';
    if (!isHexAddress(poolAddress))
        return null; // no verified pool — refuse
    const candidates = readObservationCandidates(observation);
    const candidate = pickCandidate(candidates, {
        side: rawAction,
        tradeActions: ['REMOVE', 'CREATE', 'REPOSITION'],
    });
    if (!candidate)
        return null; // no LP candidate — honest no-op
    const lowerTick = typeof candidate.lowerTick === 'number' ? candidate.lowerTick : null;
    const upperTick = typeof candidate.upperTick === 'number' ? candidate.upperTick : null;
    if (lowerTick == null || upperTick == null || lowerTick >= upperTick)
        return null;
    // Amount: sanitized integer wei. Liquidity for REMOVE comes from the
    // observed position; CREATE/REPOSITION keep the model's liquidity only if
    // it is already a clean integer string (never a float).
    const position = obsData.position;
    const amount = lpAction === 'REMOVE'
        ? toWeiIntegerString(position?.liquidity ?? proposal.amount)
        : toWeiIntegerString(proposal.amount);
    if (amount == null)
        return null; // refuse to spend/mint blindly
    const enriched = {
        ...proposal,
        action: canonical,
        protocol: 'pancakeswap',
        contract: poolAddress,
        function: LP_FUNCTIONS[lpAction],
        amount,
        estimatedValue: amount,
        params: {
            ...(proposal.params ?? {}),
            execKind: 'PANCAKE_V3_LP',
            lpAction,
            poolAddress,
            lowerTick,
            upperTick,
            positionId: typeof candidate.positionId === 'string' ? candidate.positionId : '',
            requestedAction: rawAction,
        },
    };
    const revalidated = ActionProposalSchema.safeParse(enriched);
    if (!revalidated.success) {
        throw new BANError(ErrorCode.INTERNAL, `LP strategy produced an invalid canonical proposal: ${revalidated.error.message}`, { retryable: false });
    }
    return revalidated.data;
}
