/**
 * M10 — Health Factor Monitoring strategy shared types.
 *
 * All monetary quantities are expressed as INTEGER decimal strings (wei/sat) or
 * INTEGER basis points (bps) / scaled integers so the deterministic health
 * math never depends on floating-point arithmetic. The only float→int boundary
 * happens once at the adapter boundary (price USD → integer cents), and every
 * downstream calculation is integer math.
 */
export {};
