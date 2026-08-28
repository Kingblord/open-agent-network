/**
 * M9 — Yield Optimisation strategy shared types.
 *
 * All monetary/economic quantities are expressed as INTEGER basis points (bps)
 * so the effective-yield calculation never depends on floating-point arithmetic.
 * The only float→int conversion happens once at the adapter boundary
 * (APY percent → bps), and every downstream subtraction is integer math.
 */
export {};
