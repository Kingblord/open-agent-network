/**
 * AddressVerifier — EIP-55 checksum + BNB-chain-aware address verification.
 *
 * Mustflow §10: addresses must be verified against authoritative sources
 * and/or on-chain verification before being enabled for execution. This module
 * provides:
 *   - `isValidEip55`     — strict EIP-55 checksum validation.
 *   - `isValidAddress`   — structural 0x + 40-hex check (non-checksummed inputs
 *                          allowed for read-only contexts).
 *   - `checksumAddress`  — compute the canonical EIP-55 mixed-case form.
 *   - `assertSameAddress`— constant-time (per-char) equality for allowlist
 *                          comparisons so registry checks resist trivial
 *                          timing observations.
 *
 * NEVER enables an unverified address. The registry treats an address as
 * "registered" only after it appears in the Contract/Token registry with an
 * explicit `verified: true` + `enabled: true` (see contract-registry /
 * token-registry). This module is the syntactic gate, not the authority gate.
 */
/** Structural check: 0x + 40 hex chars (allows mixed case, no checksum check). */
export declare function isValidAddress(value: string): boolean;
/** Result of EIP-55 verification. */
export interface Eip55Result {
    valid: boolean;
    /** True when the input had mixed case AND passed checksum. */
    checksummed: boolean;
    reason?: string;
}
/**
 * Injectable keccak-256 (defaults to a conservative no-op so the module is
 * dependency-free and always offline-safe). Inject viem's `keccak256` in the
 * app layer for real checksum verification.
 */
export type Keccak256 = (input: string) => string;
/**
 * EIP-55 checksum validator. When `keccak` is provided, performs the full
 * mixed-case check. Without a keccak, only validates structure (never enables).
 */
export declare class Eip55Validator {
    private readonly keccak?;
    constructor(keccak?: Keccak256 | undefined);
    verify(value: string): Eip55Result;
}
/**
 * Compute the EIP-55 mixed-case checksummed form of an address given a keccak
 * function. Throws on structurally invalid input.
 */
export declare function checksumAddress(address: string, keccak: Keccak256): string;
/** Constant-ish time equality for address allowlist comparisons. */
export declare function assertSameAddress(a: string, b: string): boolean;
/** Normalize an address to lowercase for index/comparison keys. */
export declare function normalizeAddress(address: string): string;
/**
 * Chain-aware verifier: an address is only "usable" when:
 *   - structurally valid, AND
 *   - (optionally) checksum-verified, AND
 *   - its chainId matches the BAN execution chain (default mainnet 56).
 */
export declare class BnbAddressVerifier {
    private readonly opts;
    constructor(opts?: {
        /** Expected chain (default BSC mainnet). */
        chainId?: number;
        /** Injectable keccak for EIP-55. If absent, checksum is skipped (never enables). */
        keccak?: Keccak256;
    });
    verify(address: string, chainId: number): {
        ok: boolean;
        reason?: string;
    };
}
//# sourceMappingURL=address-verifier.d.ts.map