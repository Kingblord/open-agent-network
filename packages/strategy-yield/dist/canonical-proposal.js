import { ActionProposalSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { canonicalizeAction, readObservationCandidates, toWeiIntegerString, isHexAddress, } from '@ban/agent-core';
/**
 * Deterministic canonicalization of yield proposals (real-funds safety).
 *
 * The yield strategy's candidates are OPPORTUNITIES (protocol + asset +
 * yield breakdown), not actions — the model otherwise invents the whole
 * proposal, including the contract address. Here the executor-facing fields
 * come exclusively from the verified BSC deployment set:
 *   - venus → vToken for the asset (mint = supply into Venus Core Pool)
 *   - aave  → Aave V3 Pool (supply)
 * Any other protocol fails closed (null → honest no-op) until its deployment
 * is verified and an execution builder exists.
 */
/** BSC mainnet underlying tokens (18 decimals). */
const UNDERLYING = {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    BNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
};
/** Venus Core Pool vTokens (verified on-chain 2026-08-28, per @ban/registry). */
const VENUS_VTOKENS = {
    USDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', // vUSDT
    USDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', // vUSDC
    BNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', // vBNB
};
/** Aave V3 Pool (verified on-chain 2026-08-28, per @ban/registry). */
const AAVE_V3_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';
/** Resolve the deterministic deposit target for a protocol+asset pair. */
function resolveTarget(protocol, asset, action) {
    if (protocol === 'venus' && VENUS_VTOKENS[asset]) {
        return {
            contract: VENUS_VTOKENS[asset],
            fn: action === 'DEPOSIT' ? 'mint' : 'redeemUnderlying',
            execKind: 'VENUS_LENDING',
        };
    }
    if (protocol === 'aave' && UNDERLYING[asset]) {
        return {
            contract: AAVE_V3_POOL,
            fn: action === 'DEPOSIT' ? 'supply' : 'withdraw',
            execKind: 'AAVE_V3',
        };
    }
    return null; // unverified protocol/asset pair → fail closed
}
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
export function canonicalizeYieldProposal(proposal, observation, userWalletAddress, depositUsdCents) {
    const { action: canonical, directive } = canonicalizeAction(proposal.action);
    if (directive)
        return null;
    // Invest-style canonical actions deposit; harvest-style withdraw.
    const intent = canonical === 'WITHDRAW' || canonical === 'UNSTAKE' ? 'WITHDRAW' : 'DEPOSIT';
    const candidates = readObservationCandidates(observation);
    if (candidates.length === 0)
        return null; // no opportunities — honest no-op
    // Yield candidates are OPPORTUNITIES (no `action` field) — match directly on
    // the proposal's asset, falling back to the top-ranked candidate.
    const requestedAsset = typeof proposal.asset === 'string' ? proposal.asset.trim().toUpperCase() : '';
    const candidate = candidates.find((c) => (c.asset ?? '').trim().toUpperCase() === requestedAsset) ??
        candidates[0];
    if (!candidate)
        return null;
    const protocol = typeof candidate.protocol === 'string' ? candidate.protocol.trim().toLowerCase() : '';
    const asset = typeof candidate.asset === 'string' ? candidate.asset.trim().toUpperCase() : '';
    const target = resolveTarget(protocol, asset, intent);
    if (!target || !isHexAddress(target.contract))
        return null; // fail closed
    // DETERMINISTIC AMOUNT (never the LLM's raw number):
    //  - DEPOSIT  → the TASK BUDGET (depositUsdCents, from the task's maxTxUsd ×
    //               100) converted to the underlying's integer wei. The model's
    //               "amount" is an arbitrary number (e.g. '50000' = $5e-14 wei)
    //               and MUST NOT become the broadcast size — the user's per-tx
    //               budget is the only honest size authority. Stables peg $1 →
    //               wei = cents × 1e16. No budget → fail closed (never invent).
    //  - WITHDRAW → the model's amount is accepted ONLY as clean integer wei
    //               (a harvest redeems an existing position; the position's
    //               units are the honest size). Anything else fails closed.
    const modelAmountRaw = toWeiIntegerString(proposal.amount);
    let amount = null;
    if (intent === 'DEPOSIT') {
        const budgetCents = Number.isFinite(Number(depositUsdCents)) && Number(depositUsdCents) > 0
            ? BigInt(Math.floor(Number(depositUsdCents)))
            : null;
        if (budgetCents == null)
            return null; // no task budget — refuse to spend blindly
        amount = (budgetCents * 10n ** 16n).toString(); // cents → 18-dec wei
    }
    else {
        amount = modelAmountRaw; // WITHDRAW: clean wei only, else null → honest no-op
    }
    if (amount == null)
        return null;
    const candidateRisk = typeof candidate.risk === 'string' ? candidate.risk.trim().toUpperCase() : '';
    const deterministicRisk = candidateRisk === 'LOW' || candidateRisk === 'MEDIUM' || candidateRisk === 'HIGH'
        ? candidateRisk
        : 'MEDIUM';
    // USER-WALLET-AWARE: when the owner's wallet is known, a DEPOSIT of the
    // user's capital lands ON THE USER's position. Venus uses mintBehalf
    // (verified present on the deployed vTokens); Aave's supply already takes
    // onBehalfOf via the signer (fn stays 'supply'). WITHDRAW stays agent-owned
    // (no redeemUnderlyingBehalf on the deployed vTokens).
    const beneficiary = typeof userWalletAddress === 'string' && isHexAddress(userWalletAddress)
        ? userWalletAddress
        : null;
    const fn = intent === 'DEPOSIT' && protocol === 'venus' && beneficiary ? 'mintBehalf' : target.fn;
    const enriched = {
        ...proposal,
        action: intent,
        protocol,
        contract: target.contract,
        function: fn,
        token: UNDERLYING[asset] ?? '',
        amount,
        estimatedValue: amount,
        asset,
        // REAL-FUNDS SAFETY: riskLevel is an EXECUTION-AUTHORITY field gated by
        // the policy risk matrix — deterministic from the candidate's risk tier,
        // never the LLM's vocabulary.
        riskLevel: deterministicRisk,
        params: {
            ...(proposal.params ?? {}),
            execKind: target.execKind,
            yieldAction: intent,
            requestedAction: typeof proposal.params?.requestedAction === 'string'
                ? proposal.params.requestedAction
                : proposal.action,
            // The LLM's raw amount is archived (auditability) but NEVER the
            // broadcast size — the deterministic amount above is.
            ...(modelAmountRaw ? { requestedAmount: modelAmountRaw } : {}),
            // The signer needs the OWNER's wallet to build onBehalf calls — stamped
            // here (and again by run-cycle before policy) so the executor never acts
            // on the wrong account.
            ...(beneficiary ? { userWalletAddress: beneficiary } : {}),
        },
    };
    const revalidated = ActionProposalSchema.safeParse(enriched);
    if (!revalidated.success) {
        throw new BANError(ErrorCode.INTERNAL, `Yield strategy produced an invalid canonical proposal: ${revalidated.error.message}`, { retryable: false });
    }
    return revalidated.data;
}
