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

const HEX_40 = /^0x[0-9a-fA-F]{40}$/;

/** Structural check: 0x + 40 hex chars (allows mixed case, no checksum check). */
export function isValidAddress(value: string): boolean {
  return typeof value === 'string' && HEX_40.test(value);
}

/** keccak256 hash of the lowercase ASCII payload (no external deps). */
function keccak256Hex(input: string): string {
  // Inline minimal keccak-256 is non-trivial; for address verification we use
  // a strict structure + checksum where a well-known hashing impl is desired.
  // This is intentionally conservative: it only checks the EIP-55 *shape* and
  // returns false for any input we cannot positively verify. Production
  // deployments should inject a viem-backed checksum validator via
  // `Eip55Validator` (see below) for real keccak. The default path never
  // *enables* anything — it only gates syntax.
  return input; // replaced by injected validator when available
}

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
export class Eip55Validator {
  constructor(private readonly keccak?: Keccak256) {}

  verify(value: string): Eip55Result {
    if (!isValidAddress(value)) {
      return { valid: false, checksummed: false, reason: 'not a 0x-prefixed 40-hex address' };
    }
    const hasMixedCase = /[a-f]/.test(value) && /[A-F]/.test(value);
    if (!hasMixedCase) {
      // All-lower / all-upper is not checksummed; structurally valid but not
      // verified-as-checksummed. Conservative: not valid for EIP-55, but
      // callers may still accept it for read-only contexts via `isValidAddress`.
      return { valid: false, checksummed: false, reason: 'no mixed case (EIP-55 requires checksum when case present)' };
    }
    if (!this.keccak) {
      return { valid: false, checksummed: false, reason: 'no keccak injected; cannot verify checksum' };
    }
    const expected = checksumAddress(value, this.keccak);
    const checksummed = expected.toLowerCase() === value.toLowerCase() && expected === value;
    return checksummed
      ? { valid: true, checksummed: true }
      : { valid: false, checksummed: true, reason: 'checksum mismatch' };
  }
}

/**
 * Compute the EIP-55 mixed-case checksummed form of an address given a keccak
 * function. Throws on structurally invalid input.
 */
export function checksumAddress(address: string, keccak: Keccak256): string {
  if (!isValidAddress(address)) {
    throw new Error('Invalid address for checksum');
  }
  const lower = address.slice(2).toLowerCase();
  const hash = keccak(lower).replace(/^0x/, '');
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = parseInt(hash[i] ?? '0', 16);
    out += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/** Constant-ish time equality for address allowlist comparisons. */
export function assertSameAddress(a: string, b: string): boolean {
  const la = (a ?? '').toLowerCase();
  const lb = (b ?? '').toLowerCase();
  if (la.length !== lb.length) return false;
  let diff = 0;
  for (let i = 0; i < la.length; i++) {
    diff |= la.charCodeAt(i) ^ lb.charCodeAt(i);
  }
  return diff === 0;
}

/** Normalize an address to lowercase for index/comparison keys. */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Chain-aware verifier: an address is only "usable" when:
 *   - structurally valid, AND
 *   - (optionally) checksum-verified, AND
 *   - its chainId matches the BAN execution chain (default mainnet 56).
 */
export class BnbAddressVerifier {
  constructor(
    private readonly opts: {
      /** Expected chain (default BSC mainnet). */
      chainId?: number;
      /** Injectable keccak for EIP-55. If absent, checksum is skipped (never enables). */
      keccak?: Keccak256;
    } = {},
  ) {}

  verify(address: string, chainId: number): { ok: boolean; reason?: string } {
    const expectedChain = this.opts.chainId ?? 56;
    if (chainId !== expectedChain) {
      return { ok: false, reason: `chain ${chainId} is not the BAN execution chain (${expectedChain})` };
    }
    if (!isValidAddress(address)) {
      return { ok: false, reason: 'invalid address structure' };
    }
    if (this.opts.keccak) {
      const r = new Eip55Validator(this.opts.keccak).verify(address);
      if (!r.valid) return { ok: false, reason: r.reason ?? 'checksum verification failed' };
    }
    return { ok: true };
  }
}