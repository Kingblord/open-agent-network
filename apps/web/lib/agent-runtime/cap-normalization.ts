import 'server-only';

import { getBnbUsdPrice } from '@/lib/bnb-price';
import type { ActionProposal } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';

/**
 * Session caps are denominated in BNB wei (the task form converts USD inputs
 * at the BNB price), but stablecoin proposals carry estimatedValue in token
 * wei (USDT/USDC wei ≈ dollars × 1e18 — ~600× a BNB-wei equivalent at $600).
 * Comparing raw token wei against a BNB-wei cap denies every legitimate
 * stablecoin action with a bogus "exceeds per-transaction cap" error.
 *
 * This module converts a stablecoin estimatedValue to its BNB-wei equivalent
 * (fixed-point, deterministic) so the per-tx / daily cap comparisons and the
 * spend ledger stay coherent. Extracted so the exact math is regression-tested.
 */
export const STABLECOIN_ADDRESSES = new Set([
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
]);

/**
 * Convert a stablecoin estimatedValue to its BNB-wei equivalent so the
 * policy caps (denominated in BNB wei) and the spend ledger stay coherent.
 * Fixed-point: bnbWei = tokenWei × 1e6 / (priceUsd × 1e6). Fails closed
 * (throws) when the price feed is unavailable — never guesses a rate.
 *
 * The spent token is resolved from `proposal.token` first, falling back to
 * `proposal.params.underlying` (health/yield canonical proposals always set
 * it) so a strategy that ever sets a vToken as `token` still converts.
 */
export async function normalizeProposalValueForCaps(
  proposal: ActionProposal,
  correlationId: string,
): Promise<ActionProposal> {
  // Health/yield canonical proposals set BOTH `token` (underlying spent) and
  // `params.underlying`. A strategy may set `token` to a vToken (receipt)
  // address — try BOTH so the underlying stablecoin is always recognized.
  const tokens = [
    String(proposal.token ?? '').toLowerCase(),
    String(proposal.params?.underlying ?? '').toLowerCase(),
  ];
  const isStablecoin = tokens.some((t) => STABLECOIN_ADDRESSES.has(t));
  if (!isStablecoin) return proposal; // BNB/WBNB-wei already

  const price = await getBnbUsdPrice();
  if (price == null || price <= 0) {
    throw new BANError(
      ErrorCode.POLICY_DENIED,
      'BNB/USD price unavailable — cannot value a stablecoin spend against the BNB-denominated session caps (fail-closed). No transaction was attempted.',
      { correlationId },
    );
  }

  const priceScaled = BigInt(Math.round(price * 1e6)); // USD × 1e6
  const tokenWei = BigInt(proposal.estimatedValue);
  const bnbWeiEquivalent = (tokenWei * 1000000n) / priceScaled;

  return { ...proposal, estimatedValue: bnbWeiEquivalent.toString() };
}