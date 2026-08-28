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
import { BANError, ErrorCode } from '@ban/shared';
import { normalizeAddress, assertSameAddress } from './address-verifier.js';
export class TokenRegistry {
    opts;
    byId = new Map();
    byAddress = new Map();
    bySymbol = new Map();
    constructor(opts = {}) {
        this.opts = opts;
        for (const token of opts.tokens ?? []) {
            this.register(token);
        }
    }
    get chainId() {
        return this.opts.chainId ?? 56;
    }
    register(token) {
        if (token.chainId !== this.chainId) {
            throw new BANError(ErrorCode.TOKEN_NOT_ALLOWED, `Token ${token.id} chainId ${token.chainId} does not match registry chain ${this.chainId}`);
        }
        const addrKey = normalizeAddress(token.address);
        this.byId.set(token.id.toLowerCase(), token);
        this.byAddress.set(addrKey, token);
        this.bySymbol.set(token.symbol.toUpperCase(), token);
    }
    getById(id) {
        return this.byId.get(id.toLowerCase()) ?? null;
    }
    /** Look up by exact address (case-insensitive). */
    getByAddress(address) {
        return this.byAddress.get(normalizeAddress(address)) ?? null;
    }
    getBySymbol(symbol) {
        return this.bySymbol.get(symbol.toUpperCase()) ?? null;
    }
    list() {
        return [...this.byId.values()];
    }
    /** A token may be used for EXECUTION only when verified AND enabled AND on this chain. */
    isEnabled(token) {
        const record = typeof token === 'string' ? this.getByAddress(token) ?? this.getBySymbol(token) ?? this.getById(token) : token;
        if (!record)
            return false;
        return record.verified && record.enabled && record.chainId === this.chainId;
    }
    /** Fail-closed: any unknown / unverified / disabled token is denied. */
    requireEnabled(token) {
        const record = typeof token === 'string' ? this.getByAddress(token) ?? this.getBySymbol(token) ?? this.getById(token) : token;
        if (!record) {
            throw new BANError(ErrorCode.TOKEN_NOT_ALLOWED, `Token not registered: ${String(token)}`);
        }
        if (!record.verified) {
            throw new BANError(ErrorCode.TOKEN_NOT_ALLOWED, `Token ${record.symbol} is not verified`);
        }
        if (!record.enabled) {
            throw new BANError(ErrorCode.TOKEN_NOT_ALLOWED, `Token ${record.symbol} is verified but not enabled for autonomous execution`);
        }
        if (record.chainId !== this.chainId) {
            throw new BANError(ErrorCode.TOKEN_NOT_ALLOWED, `Token ${record.symbol} is on chain ${record.chainId}, not ${this.chainId}`);
        }
        return record;
    }
    /** Equivalence via constant-time address comparison (allowlist integrity). */
    matchesAddress(a, b) {
        return assertSameAddress(a, b);
    }
}
