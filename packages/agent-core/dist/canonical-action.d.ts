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
/** Canonical onchain action enum (mirrors ActionTypeSchema). */
export declare const CANONICAL_ACTIONS: ReadonlySet<string>;
/** Strategy vocabulary → canonical action. */
export declare const STRATEGY_ACTION_MAP: Readonly<Record<string, CanonicalAction>>;
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
export declare function canonicalizeAction(raw: unknown): CanonicalActionResult;
/**
 * Coerce a value to an integer wei string (18-decimal token units).
 * Accepts already-integer strings/numbers; floors fractional decimal input.
 * Returns null when the value cannot be interpreted or is not positive.
 */
export declare function toWeiIntegerString(value: unknown): string | null;
/** Structural EVM address check (0x + 40 hex). Never a chain lookup. */
export declare function isHexAddress(value: unknown): value is string;
/**
 * Normalize a RAW brain decision (pre-schema): maps strategy vocabulary in
 * `proposal.action` to the canonical enum (BUY/SELL→SWAP, REPAY/
 * ADD_COLLATERAL→DEPOSIT, REMOVE/CREATE/REPOSITION→BURN/MINT/REBALANCE) and
 * preserves the raw value in `params.requestedAction` / `params.side`.
 * Directives (STOP/HOLD/WAIT/NONE/…) → null (caller converts to PASS).
 * Malformed (non-object) input or a non-string action passes through untouched
 * so schema validation still fails closed.
 */
export declare function normalizeStrategyDecision<T>(decision: T): T | null;
/**
 * Read the bounded candidate list an observation carries. Strategy
 * observation builders all place deterministic candidates under `data`.
 */
export declare function readObservationCandidates<T = Record<string, unknown>>(observation: unknown): T[];
/**
 * Extract the deterministic candidate matching a decision's side/level hint,
 * falling back to the first trade-action candidate. Shared matching rule so
 * grid/lp/health behave identically.
 */
export declare function pickCandidate(candidates: Array<Record<string, unknown>>, opts: {
    side?: string;
    indexField?: string;
    indexValue?: unknown;
    tradeActions: string[];
}): Record<string, unknown> | null;
//# sourceMappingURL=canonical-action.d.ts.map