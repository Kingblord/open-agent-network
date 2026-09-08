import type { ActionProposal, Observation } from '@ban/schemas';
import { ActionProposalSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import {
  canonicalizeAction,
  readObservationCandidates,
  toWeiIntegerString,
  isHexAddress,
} from '@ban/agent-core';

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
const UNDERLYING: Record<string, string> = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  BNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
};

/** Venus Core Pool vTokens (verified on-chain 2026-08-28, per @ban/registry). */
const VENUS_VTOKENS: Record<string, string> = {
  USDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', // vUSDT
  USDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', // vUSDC
  BNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', // vBNB
};

/** Aave V3 Pool (verified on-chain 2026-08-28, per @ban/registry). */
const AAVE_V3_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';

interface ResolvedTarget {
  contract: string;
  fn: string;
  execKind: string;
}

/** Resolve the deterministic deposit target for a protocol+asset pair. */
function resolveTarget(
  protocol: string,
  asset: string,
  action: 'DEPOSIT' | 'WITHDRAW',
): ResolvedTarget | null {
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
 */
export function canonicalizeYieldProposal(
  proposal: ActionProposal,
  observation: Observation,
): ActionProposal | null {
  const { action: canonical, directive } = canonicalizeAction(proposal.action);
  if (directive) return null;

  // Invest-style canonical actions deposit; harvest-style withdraw.
  const intent: 'DEPOSIT' | 'WITHDRAW' =
    canonical === 'WITHDRAW' || canonical === 'UNSTAKE' ? 'WITHDRAW' : 'DEPOSIT';

  const candidates = readObservationCandidates<{
    asset?: string;
    protocol?: string;
    risk?: string;
  }>(observation);
  if (candidates.length === 0) return null; // no opportunities — honest no-op

  // Yield candidates are OPPORTUNITIES (no `action` field) — match directly on
  // the proposal's asset, falling back to the top-ranked candidate.
  const requestedAsset =
    typeof proposal.asset === 'string' ? proposal.asset.trim().toUpperCase() : '';
  const candidate =
    candidates.find((c) => (c.asset ?? '').trim().toUpperCase() === requestedAsset) ??
    candidates[0];
  if (!candidate) return null;

  const protocol =
    typeof candidate.protocol === 'string' ? candidate.protocol.trim().toLowerCase() : '';
  const asset = typeof candidate.asset === 'string' ? candidate.asset.trim().toUpperCase() : '';
  const target = resolveTarget(protocol, asset, intent);
  if (!target || !isHexAddress(target.contract)) return null; // fail closed

  const amount = toWeiIntegerString(proposal.amount);
  if (amount == null) return null; // no sane amount — refuse to spend blindly

  const candidateRisk =
    typeof candidate.risk === 'string' ? candidate.risk.trim().toUpperCase() : '';
  const deterministicRisk =
    candidateRisk === 'LOW' || candidateRisk === 'MEDIUM' || candidateRisk === 'HIGH'
      ? candidateRisk
      : 'MEDIUM';

  const enriched: ActionProposal = {
    ...proposal,
    action: intent,
    protocol,
    contract: target.contract as `0x${string}`,
    function: target.fn,
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
      requestedAction:
        typeof proposal.params?.requestedAction === 'string'
          ? proposal.params.requestedAction
          : proposal.action,
    },
  };

  const revalidated = ActionProposalSchema.safeParse(enriched);
  if (!revalidated.success) {
    throw new BANError(
      ErrorCode.INTERNAL,
      `Yield strategy produced an invalid canonical proposal: ${revalidated.error.message}`,
      { retryable: false },
    );
  }
  return revalidated.data;
}
