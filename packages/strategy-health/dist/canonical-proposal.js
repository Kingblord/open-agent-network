import { ActionProposalSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { canonicalizeAction, readObservationCandidates, pickCandidate, toWeiIntegerString, isHexAddress, } from '@ban/agent-core';
/**
 * Deterministic canonicalization of health/lending proposals (real-funds
 * safety): the brain only chooses REPAY vs ADD_COLLATERAL (vs PASS). The
 * contract, function, token and amount below are strategy-authored from
 * verified BSC mainnet constants and the observation's candidates — NEVER
 * model-authored values, which could be hallucinated.
 *
 * Venus Core Pool is the only executable lending protocol in the verified
 * deployment set. Any other protocol fails closed (null → honest no-op) until
 * its deployment is verified and its execution builder exists.
 */
/** BSC mainnet USDT / USDC / WBNB (18 decimals each). */
const UNDERLYING = {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    BNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
};
/** Venus Core Pool vTokens (verified on-chain 2026-08-28, per @ban/registry). */
export const HEALTH_VTOKENS = {
    USDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', // vUSDT
    USDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', // vUSDC
    BNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', // vBNB
};
/** vToken entrypoint per corrective action. */
const VTOKEN_FUNCTIONS = {
    ADD_COLLATERAL: 'mint',
    REPAY: 'repayBorrow',
};
/**
 * Canonicalize a health proposal:
 *  - action → canonical enum (REPAY/ADD_COLLATERAL → DEPOSIT, directive → null)
 *  - contract → the verified Venus vToken for the asset
 *  - amount → integer wei derived from the candidate's amountCentsUsd
 *  - params.healthAction / params.execKind = 'VENUS_LENDING'
 * Returns null when there is no executable candidate or the protocol/asset
 * cannot be deterministically resolved (honest no-op, never fabricated).
 */
export function canonicalizeHealthProposal(proposal, observation) {
    const { directive } = canonicalizeAction(proposal.action);
    if (directive)
        return null;
    const rawAction = typeof proposal.params?.requestedAction === 'string'
        ? proposal.params.requestedAction.toUpperCase()
        : proposal.action.toUpperCase();
    const healthAction = VTOKEN_FUNCTIONS[rawAction] ? rawAction : 'ADD_COLLATERAL';
    const candidates = readObservationCandidates(observation);
    const tradeActions = ['REPAY', 'ADD_COLLATERAL'];
    const requestedSide = rawAction;
    const candidate = pickCandidate(candidates, {
        side: requestedSide,
        tradeActions,
    });
    if (!candidate)
        return null; // no corrective candidate — honest no-op
    const protocol = typeof candidate.protocol === 'string' && candidate.protocol
        ? candidate.protocol.toLowerCase()
        : 'venus';
    if (protocol !== 'venus')
        return null; // unverified protocol → fail closed
    // Asset: prefer the proposal's asset symbol; fall back to USDT only when the
    // model named none (the vToken choice must still be a verified mapping).
    const assetRaw = typeof proposal.asset === 'string' ? proposal.asset.trim().toUpperCase() : '';
    const asset = HEALTH_VTOKENS[assetRaw] ? assetRaw : '';
    if (!asset)
        return null; // cannot deterministically pick a vToken — fail closed
    const vToken = HEALTH_VTOKENS[asset];
    if (!isHexAddress(vToken))
        return null;
    // Deterministic amount: candidate's USD cents → 18-decimal wei (cents × 1e16).
    // Falls back to the model's amount only when it is already a clean integer
    // wei string (never a float the policy BigInt would crash on).
    const cents = toWeiIntegerString(candidate.amountCentsUsd);
    const amount = cents != null
        ? (BigInt(cents) * 10n ** 16n).toString()
        : toWeiIntegerString(proposal.amount);
    if (amount == null)
        return null; // no sane amount — refuse to spend blindly
    const enriched = {
        ...proposal,
        action: 'DEPOSIT',
        protocol,
        contract: vToken,
        function: VTOKEN_FUNCTIONS[healthAction],
        token: UNDERLYING[asset],
        amount,
        estimatedValue: amount,
        asset,
        params: {
            ...(proposal.params ?? {}),
            execKind: 'VENUS_LENDING',
            healthAction,
            vToken,
            underlying: UNDERLYING[asset],
            requestedAction: rawAction,
        },
    };
    const revalidated = ActionProposalSchema.safeParse(enriched);
    if (!revalidated.success) {
        throw new BANError(ErrorCode.INTERNAL, `Health strategy produced an invalid canonical proposal: ${revalidated.error.message}`, { retryable: false });
    }
    return revalidated.data;
}
