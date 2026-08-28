/**
 * TokenRegistry — BAN internal source of truth for executable tokens.
 *
 * Mustflow §12:
 *   - `verified` (recognized/real) is SEPARATE from `enabled` (allowed for
 *     autonomous execution).
 *   - `verified ≠ executable`. A token can be recognized without being allowed
 *     for autonomous execution.
 *
 * The registry is fail-closed:
 *   - `isEnabled()` returns false for unknown tokens, and false for verified
 *     but not-enabled tokens.
 *   - `requireEnabled()` throws `ErrorCode.TOKEN_NOT_ALLOWED` unless the token
 *     is registered AND enabled AND on the BAN execution chain.
 */
export interface TokenRecord {
    /** Canonical token id (e.g. "usdt"). */
    id: string;
    chainId: number;
    /** EIP-55 / normalized address. */
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    /** Recognized as a real/verified asset. */
    verified: boolean;
    /** Allowed for autonomous execution. verified ≠ enabled. */
    enabled: boolean;
    /** Native gas token (e.g. BNB). */
    native?: boolean;
}
export declare class TokenRegistry {
    private readonly opts;
    private readonly byId;
    private readonly byAddress;
    private readonly bySymbol;
    constructor(opts?: {
        chainId?: number;
        tokens?: TokenRecord[];
    });
    get chainId(): number;
    register(token: TokenRecord): void;
    getById(id: string): TokenRecord | null;
    /** Look up by exact address (case-insensitive). */
    getByAddress(address: string): TokenRecord | null;
    getBySymbol(symbol: string): TokenRecord | null;
    list(): TokenRecord[];
    /** A token may be used for EXECUTION only when verified AND enabled AND on this chain. */
    isEnabled(token: TokenRecord | string | null): boolean;
    /** Fail-closed: any unknown / unverified / disabled token is denied. */
    requireEnabled(token: TokenRecord | string): TokenRecord;
    /** Equivalence via constant-time address comparison (allowlist integrity). */
    matchesAddress(a: string, b: string): boolean;
}
//# sourceMappingURL=token-registry.d.ts.map