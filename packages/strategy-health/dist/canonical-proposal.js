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
export function canonicalizeHealthProposal(proposal, observation, userWalletAddress) {
    const { directive } = canonicalizeAction(proposal.action);
    if (directive)
        return null;
    const rawAction = typeof proposal.params?.requestedAction === 'string'
        ? proposal.params.requestedAction.toUpperCase()
        : '';
    const candidates = readObservationCandidates(observation);
    // When the model sent a CANONICAL action (DEPOSIT) with no requestedAction,
    // derive the intent from the corrected candidate list (deterministic) —
    // never from the model's canonical enum, which cannot distinguish REPAY
    // from ADD_COLLATERAL.
    const fallbackAction = candidates.find((c) => {
        const a = typeof c.action === 'string' ? c.action.toUpperCase() : '';
        return a === 'REPAY' || a === 'ADD_COLLATERAL';
    })?.action?.toUpperCase() ?? '';
    const healthActionRaw = rawAction || fallbackAction || 'ADD_COLLATERAL';
    const healthAction = VTOKEN_FUNCTIONS[healthActionRaw] ? healthActionRaw : 'ADD_COLLATERAL';
    const tradeActions = ['REPAY', 'ADD_COLLATERAL'];
    // Match the candidate by the DETERMINED health action so a REPAY when the
    // wallet holds no REPAY candidate can never be invented (ADD_COLLATERAL
    // would be the deterministic alternative).
    const requestedSide = healthAction;
    const candidate = pickCandidate(candidates, {
        side: requestedSide,
        tradeActions,
    });
    if (!candidate)
        return null; // no corrective candidate — honest no-op
    // The candidate's action is authoritative for the executor function — a
    // REPAY decision with only an ADD_COLLATERAL candidate stays ADD_COLLATERAL
    // (deterministic; the model's side hint was already consumed above).
    const finalHealthAction = typeof candidate.action === 'string' && VTOKEN_FUNCTIONS[candidate.action.toUpperCase()]
        ? candidate.action.toUpperCase()
        : healthAction;
    const protocol = typeof candidate.protocol === 'string' && candidate.protocol
        ? candidate.protocol.toLowerCase()
        : 'venus';
    if (protocol !== 'venus')
        return null; // unverified protocol → fail closed
    // Asset: authoritative from the DETERMINISTIC candidate (the debt token for
    // REPAY / the collateral market for ADD_COLLATERAL) — never from the model,
    // which invents symbols like "collateral" that would silently fail the cycle
    // or, worse, could send funds to the wrong vToken.
    const candidateDenom = typeof candidate.denomination === 'string' ? candidate.denomination.trim().toUpperCase() : '';
    const modelAsset = typeof proposal.asset === 'string' ? proposal.asset.trim().toUpperCase() : '';
    // Accept the model's asset ONLY when it names a verified underlying that
    // exists in the debt breakdown (or adds collateral on a verified market);
    // otherwise use the candidate's deterministic denomination.
    const asset = (HEALTH_VTOKENS[modelAsset] &&
        (finalHealthAction === 'ADD_COLLATERAL' || !candidateDenom || modelAsset === candidateDenom))
        ? modelAsset
        : (HEALTH_VTOKENS[candidateDenom] ? candidateDenom : '');
    if (!asset)
        return null; // cannot deterministically pick a vToken — fail closed
    const vToken = HEALTH_VTOKENS[asset];
    if (!isHexAddress(vToken))
        return null;
    // Deterministic amount: the candidate's EXACT debt-token wei (price-adjusted
    // at the boundary) is authoritative — repayBorrow takes the underlying
    // amount, never a cents estimate. Falls back to cents × 1e16 (the $1
    // stablecoin peg) only when no price was available, and to the model's
    // amount only when it is already a clean integer wei string.
    const exactWei = toWeiIntegerString(typeof candidate.amountWei === 'string' ? candidate.amountWei : undefined);
    const cents = toWeiIntegerString(candidate.amountCentsUsd);
    const amount = exactWei ??
        (cents != null ? (BigInt(cents) * 10n ** 16n).toString() : toWeiIntegerString(proposal.amount));
    if (amount == null)
        return null; // no sane amount — refuse to spend blindly
    // Is the position being corrected the OWNER's (vs the agent's own)? The
    // wallet must be a valid address before we execute on anyone's behalf —
    // a fabricated wallet would send the repayment into a revert.
    const beneficiary = typeof userWalletAddress === 'string' && isHexAddress(userWalletAddress)
        ? userWalletAddress
        : null;
    // On-behalf execution uses the vToken's behalf entrypoints (verified
    // present on the deployed vUSDC/vUSDT runtime code):
    //   REPAY        → repayBorrowBehalf(borrower=owner)  — agent pays, owner's debt drops
    //   ADD_COLLATERAL → mintBehalf(minter=owner)          — agent funds, owner gets vTokens
    const repayFn = beneficiary ? 'repayBorrowBehalf' : 'repayBorrow';
    const mintFn = beneficiary ? 'mintBehalf' : 'mint';
    const enriched = {
        ...proposal,
        action: 'DEPOSIT',
        protocol,
        contract: vToken,
        function: finalHealthAction === 'REPAY' ? repayFn : mintFn,
        token: UNDERLYING[asset],
        amount,
        estimatedValue: amount,
        asset,
        // REAL-FUNDS SAFETY: riskLevel is an EXECUTION-AUTHORITY field gated by
        // the policy risk matrix. It MUST be deterministic from the corrective
        // action, never the LLM's word — the model labels the POSITION state
        // ("CRITICAL") which is not the trade's risk, and would wrongly deny a
        // protective repayment on a LOW-risk agent (the 'Risk HIGH incompatible
        // with agent risk LOW' denial you saw was exactly this).
        riskLevel: finalHealthAction === 'REPAY' ? 'LOW' : 'MEDIUM',
        params: {
            ...(proposal.params ?? {}),
            execKind: 'VENUS_LENDING',
            healthAction: finalHealthAction,
            vToken,
            underlying: UNDERLYING[asset],
            requestedAction: rawAction,
            // The signer needs the OWNER's wallet to build the behalf call
            // (repayBorrowBehalf / mintBehalf). Stamped here (and again by
            // run-cycle before execution) so the executor never acts on the wrong
            // account.
            ...(beneficiary ? { userWalletAddress: beneficiary } : {}),
        },
    };
    const revalidated = ActionProposalSchema.safeParse(enriched);
    if (!revalidated.success) {
        throw new BANError(ErrorCode.INTERNAL, `Health strategy produced an invalid canonical proposal: ${revalidated.error.message}`, { retryable: false });
    }
    return revalidated.data;
}
