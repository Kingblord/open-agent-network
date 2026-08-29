import { describe, it, expect } from 'vitest';
import { normalizePrivateKey } from '@/lib/firebase-admin';

const HEADER = '-----BEGIN PRIVATE KEY-----';
const FOOTER = '-----END PRIVATE KEY-----';
const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDaFAKEKEY111';

// Canonical PEM with NO trailing newline — matches what normalizePrivateKey
// produces for every supported input format.
const PEM = `${HEADER}\n${BODY}\n${FOOTER}`;

describe('normalizePrivateKey', () => {
  it('passes through a plain multi-line PEM unchanged (format 1)', () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });

  it('unescapes literal \\n sequences in a single-line PEM (format 2)', () => {
    const escaped = `${HEADER}\\n${BODY}\\n${FOOTER}`;
    const result = normalizePrivateKey(escaped);
    expect(result).toBe(PEM);
    expect(result).not.toContain('\\n');
    expect(result).toContain('\n');
  });

  it('decodes a base64-encoded PEM (format 3)', () => {
    const b64 = Buffer.from(PEM, 'utf8').toString('base64');
    const result = normalizePrivateKey(b64);
    expect(result).toBe(PEM);
    expect(result).toContain(HEADER);
    expect(result).toContain(FOOTER);
    expect(result).toContain('\n');
  });

  it('supports RSA PEM headers in every format', () => {
    const rsaPem = `-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n-----END RSA PRIVATE KEY-----`;
    expect(normalizePrivateKey(rsaPem)).toBe(rsaPem);

    const rsaEscaped = `-----BEGIN RSA PRIVATE KEY-----\\n${BODY}\\n-----END RSA PRIVATE KEY-----`;
    expect(normalizePrivateKey(rsaEscaped)).toBe(rsaPem);

    const rsaB64 = Buffer.from(rsaPem, 'utf8').toString('base64');
    expect(normalizePrivateKey(rsaB64)).toBe(rsaPem);
  });

  it('passes through unrecognized values unchanged (format-4 fail-open)', () => {
    expect(normalizePrivateKey('not-a-key')).toBe('not-a-key');
    expect(normalizePrivateKey('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePrivateKey(`   ${PEM}   `)).toBe(PEM);
  });
});