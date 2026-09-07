import 'server-only';

/**
 * Shared bounded-authority resolution (mustflow §6, §10–13).
 *
 * The UI submits human choices (protocol ids, token symbols); the server
 * resolves them through the fail-closed BAN registries into canonical
 * contract/token addresses. This module is used by BOTH the sessions route
 * and the tasks route so there is exactly one resolution path — a task
 * creates the same kind of scoped authority a session does.
 *
 * Fail-closed:
 *   - Unknown protocol id → POLICY_DENIED.
 *   - Recognized-but-unverified deployment → CONTRACT_NOT_ALLOWED
 *     (verified ≠ enabled; mustflow §12).
 *   - Unknown token → TOKEN_NOT_ALLOWED.
 */
import { getCorrelationId } from '@/lib/core/request-context';
import { banDeployments, banTokens } from '@/lib/ban-registry';
import { BANError, ErrorCode } from '@ban/shared';

/**
 * The canonical role each selectable protocol resolves to on the BAN chain.
 * Must mirror the seeds in @ban/registry (pancakeswap → v3SwapRouter,
 * venus → comptroller). A protocol missing from this map is not selectable.
 */
export const PROTOCOL_ROLES: Record<string, string> = {
  pancakeswap: 'v3SwapRouter',
  venus: 'comptroller',
  aave: 'v3Pool',
};

/**
 * Normalize a client-supplied protocol reference to its canonical registry id.
 *
 * Accepts ids (`pancakeswap`), display names (`PancakeSwap`, `Venus`), and
 * suffixed labels (`Pancake Swap V3`, `Venus Protocol`) — case- and
 * separator-insensitive. The registry keys are `pancakeswap` / `venus`
 * (bnb-contracts.ts protocolId + DeploymentRegistry stores lowercase), so we
 * do NOT strip meaningful substrings (removing "swap" from "PancakeSwap"
 * would yield "pancake" and fail to resolve). Unknown refs return null and
 * the caller fails closed.
 */
const CANONICAL_IDS = Object.keys(PROTOCOL_ROLES);
const MIN_PARTIAL = 4;

export function normalizeProtocolId(ref: string): string | null {
  const cleaned = ref.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!cleaned) return null;
  if (CANONICAL_IDS.includes(cleaned)) return cleaned;
  for (const id of CANONICAL_IDS) {
    if (cleaned.includes(id) || (cleaned.length >= MIN_PARTIAL && id.includes(cleaned))) {
      return id;
    }
  }
  return null;
}

/** Resolve client-supplied protocol ids (+ legacy raw contract list) → canonical addresses. */
export function resolveAllowedContracts(
  protocols: string[] | undefined,
  legacy: string[] | undefined
): string[] {
  const contracts = new Set((legacy ?? []).map((c) => c.trim()).filter(Boolean));
  for (const pid of protocols ?? []) {
    const id = normalizeProtocolId(pid);
    if (!id) {
      throw new BANError(
        ErrorCode.POLICY_DENIED,
        `Protocol '${pid}' is not registered for session contracts`,
        { correlationId: getCorrelationId() }
      );
    }
    const role = PROTOCOL_ROLES[id];
    const deployment = banDeployments.get(id);
    // Fail to a user-facing error BEFORE requireAddress: recognized-but-unverified
    // deployments are not executable (verified ≠ enabled).
    if (!deployment || !deployment.verified || !deployment.contracts[role]) {
      throw new BANError(
        ErrorCode.CONTRACT_NOT_ALLOWED,
        `Protocol '${pid}' is recognized but not yet verified for autonomous execution (verified ≠ enabled). Remove it or try again later.`,
        { correlationId: getCorrelationId() }
      );
    }
    // REAL-FUNDS EXECUTION: the strategies execute against MORE than the
    // protocol's primary role — Venus supply/repay target the vTokens, not the
    // comptroller. Allowlist EVERY verified contract address of the deployment
    // (each was on-chain verified when the seed was promoted). Without this,
    // correct proposals are denied by checkContractAllowed.
    for (const address of Object.values(deployment.contracts)) {
      const trimmed = String(address ?? '').trim();
      if (trimmed) contracts.add(trimmed);
    }
  }
  return [...contracts];
}

/**
 * User-typed function words → the canonical contract function names strategies
 * actually execute, ADDITIVE (originals are kept). Without this, a session
 * created from the UI's "e.g. swap, deposit, withdraw" hint would DENY every
 * real proposal (router/lending functions are exactInputSingle/mint/
 * repayBorrow/…). Unknown words pass through untouched (fail-closed policy).
 */
const FUNCTION_ALIASES: Record<string, string[]> = {
  swap: ['exactInputSingle', 'exactInput'],
  buy: ['exactInputSingle', 'exactInput'],
  sell: ['exactInputSingle', 'exactInput'],
  deposit: ['mint', 'supply'],
  invest: ['mint', 'supply'],
  lend: ['mint', 'supply'],
  repay: ['repayBorrow'],
  withdraw: ['redeemUnderlying', 'withdraw', 'redeem'],
  unstake: ['redeemUnderlying', 'withdraw', 'redeem'],
  harvest: ['redeemUnderlying', 'withdraw', 'redeem'],
  liquidity: ['mint', 'decreaseLiquidity'],
};

export function canonicalizeAllowedFunctions(functions: string[]): string[] {
  const out = new Set<string>();
  for (const raw of functions ?? []) {
    const key = String(raw).trim().toLowerCase();
    if (!key) continue;
    out.add(String(raw).trim());
    for (const alias of FUNCTION_ALIASES[key] ?? []) out.add(alias);
  }
  return [...out];
}

/** Resolve client-supplied token symbols/ids/addresses (+ legacy raw list) → canonical addresses. */
export function resolveAllowedTokens(
  tokens: string[] | undefined,
  legacy: string[] | undefined
): string[] {
  const out = new Set((legacy ?? []).map((t) => t.trim()).filter(Boolean));
  for (const t of tokens ?? []) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const rec =
      banTokens.getBySymbol(trimmed) ??
      banTokens.getById(trimmed) ??
      banTokens.getByAddress(trimmed);
    if (!rec) {
      throw new BANError(
        ErrorCode.TOKEN_NOT_ALLOWED,
        `Token '${t}' is not registered in the BAN token registry`,
        { correlationId: getCorrelationId() }
      );
    }
    out.add(rec.address);
  }
  return [...out];
}