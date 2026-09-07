import { ActionTypeSchema } from '@ban/schemas';

/**
 * Shared canonical-action vocabulary for ALL strategy brains.
 *
 * Every strategy package (grid, yield, health, LP) exposes its own internal
 * candidate vocabulary to the LLM (BUY/SELL, REPAY/ADD_COLLATERAL,
 * REMOVE/CREATE/REPOSITION, …). The `ActionType` enum is the ONLY vocabulary
 * the schema/policy layers accept, so every brain output must be mapped
 * through this table before validation. Centralizing it prevents the exact
 * bug that hit grid production: the model copying `action: "BUY"` (or
 * `action: "REPAY"`) from the observation and the decision failing closed
 * with ERR_POLICY_DENIED.
 *
 * Semantics of the mapping:
 *  - Trading direction (BUY/SELL)  → SWAP with the side preserved in params.
 *  - Liquidity ops (REMOVE/CREATE/REPOSITION) → BURN/MINT/REBALANCE.
 *  - Lending ops (REPAY/ADD_COLLATERAL) → DEPOSIT (the token moves into the
 *    protocol in both cases; the intent is preserved in params.healthAction).
 *  - Directives (STOP/HOLD/WAIT/NONE/PASS) → null: these are decisions to
 *    NOT trade — honest PASS with no proposal, never an error.
 *  - Unknown values are returned untouched so strict validation still fails
 *    closed (fail-closed is the safety contract).
 */

/** Canonical action values (mirrors ActionTypeSchema's enum literal union). */
export type CanonicalAction = (typeof ActionTypeSchema)['options'][number];

/** Vocabulary that means "do not trade" → honest PASS (no proposal). */
const PASS_DIRECTIVES = new Set(['STOP', 'HOLD', 'WAIT', 'NONE', 'PASS', 'NOOP', 'NO_ACTION']);

/** Canonical onchain action enum (mirrors ActionTypeSchema). */
export const CANONICAL_ACTIONS: ReadonlySet<string> = new Set([
  'SWAP', 'TRANSFER', 'DEPOSIT', 'WITHDRAW', 'STAKE', 'UNSTAKE',
  'MINT', 'BURN', 'APPROVE', 'REBALANCE', 'CUSTOM',
]);

/** Strategy vocabulary → canonical action. */
export const STRATEGY_ACTION_MAP: Readonly<Record<string, CanonicalAction>> = Object.freeze({
  BUY: 'SWAP',
  SELL: 'SWAP',
  // LP strategy vocabulary
  REMOVE: 'BURN',
  REMOVE_LIQUIDITY: 'BURN',
  CREATE: 'MINT',
  ADD_LIQUIDITY: 'MINT',
  REPOSITION: 'REBALANCE',
  // Health/lending vocabulary (token moves INTO the protocol in both cases)
  REPAY: 'DEPOSIT',
  ADD_COLLATERAL: 'DEPOSIT',
  // Yield vocabulary
  INVEST: 'DEPOSIT',
  HARVEST: 'WITHDRAW',
});

/**
 * Result of canonicalizing a raw action string.
 *  - `action`: the canonical action to use.
 *  - `directive`: true when the raw value meant "do not trade" (caller should
 *    convert the decision to PASS).
 */
export interface CanonicalActionResult {
  action: CanonicalAction;
  directive: boolean;
}

/**
 * Canonicalize a raw strategy/LLM action string.
 * Returns the canonical action and whether it was a no-trade directive.
 * Unknown strings come back with `directive: false` and the raw uppercased
 * value (which will fail strict validation downstream — fail closed).
 */
export function canonicalizeAction(raw: unknown): CanonicalActionResult {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!value) return { action: 'CUSTOM', directive: true }; // empty action = no-op
  if (PASS_DIRECTIVES.has(value)) return { action: 'CUSTOM', directive: true };
  if (CANONICAL_ACTIONS.has(value)) return { action: value as CanonicalAction, directive: false };
  const mapped = STRATEGY_ACTION_MAP[value];
  if (mapped) return { action: mapped, directive: false };
  return { action: value as CanonicalAction, directive: false }; // unknown → fails closed downstream
}

/**
 * Coerce a value to an integer wei string (18-decimal token units).
 * Accepts already-integer strings/numbers; floors fractional decimal input.
 * Returns null when the value cannot be interpreted or is not positive.
 */
export function toWeiIntegerString(value: unknown): string | null {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value).toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const asNum = Number(trimmed);
      if (!Number.isSafeInteger(asNum) || asNum <= 0) return trimmed; // big ints pass through as strings
      return asNum > 0 ? trimmed : null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed).toString();
  }
  return null;
}

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Structural EVM address check (0x + 40 hex). Never a chain lookup. */
export function isHexAddress(value: unknown): value is string {
  return typeof value === 'string' && HEX_ADDRESS_RE.test(value);
}

/**
 * Normalize a RAW brain decision (pre-schema): maps strategy vocabulary in
 * `proposal.action` to the canonical enum (BUY/SELL→SWAP, REPAY/
 * ADD_COLLATERAL→DEPOSIT, REMOVE/CREATE/REPOSITION→BURN/MINT/REBALANCE) and
 * preserves the raw value in `params.requestedAction` / `params.side`.
 * Directives (STOP/HOLD/WAIT/NONE/…) → null (caller converts to PASS).
 * Malformed (non-object) input or a non-string action passes through untouched
 * so schema validation still fails closed.
 */
export function normalizeStrategyDecision<T>(decision: T): T | null {
  if (!decision || typeof decision !== 'object') return decision;
  const d = decision as { proposal?: Record<string, unknown> | unknown };
  const proposal = d.proposal;
  if (!proposal || typeof proposal !== 'object') return decision;
  const p = proposal as Record<string, unknown>;
  if (typeof p.action !== 'string') return decision;

  const { action: canonical, directive } = canonicalizeAction(p.action);
  if (directive) return null; // decision to not trade — honest PASS upstream

  const rawAction = p.action.trim().toUpperCase();
  const params = { ...((p.params as Record<string, unknown> | undefined) ?? {}) };
  if (rawAction && params.requestedAction == null) params.requestedAction = rawAction;
  if ((rawAction === 'BUY' || rawAction === 'SELL') && params.side == null) {
    params.side = rawAction;
  }
  return { ...d, proposal: { ...p, action: canonical, params } } as T;
}

/**
 * Read the bounded candidate list an observation carries. Strategy
 * observation builders all place deterministic candidates under `data`.
 */
export function readObservationCandidates<T = Record<string, unknown>>(
  observation: unknown,
): T[] {
  const data = (observation as { data?: { candidates?: unknown } } | null | undefined)?.data;
  const candidates = (data as { candidates?: unknown } | undefined)?.candidates;
  return Array.isArray(candidates) ? (candidates as T[]) : [];
}

/**
 * Extract the deterministic candidate matching a decision's side/level hint,
 * falling back to the first trade-action candidate. Shared matching rule so
 * grid/lp/health behave identically.
 */
export function pickCandidate(
  candidates: Array<Record<string, unknown>>,
  opts: { side?: string; indexField?: string; indexValue?: unknown; tradeActions: string[] },
): Record<string, unknown> | null {
  const trade = candidates.filter((c) => {
    const a = typeof c.action === 'string' ? c.action.toUpperCase() : '';
    return opts.tradeActions.includes(a);
  });
  if (trade.length === 0) return null;
  if (opts.indexField && opts.indexValue != null) {
    const byIndex = trade.find((c) => c[opts.indexField as string] === opts.indexValue);
    if (byIndex) return byIndex;
  }
  if (opts.side) {
    const bySide = trade.find(
      (c) => typeof c.action === 'string' && c.action.toUpperCase() === opts.side,
    );
    if (bySide) return bySide;
  }
  return trade[0];
}
