import { describe, it, expect } from 'vitest';
import {
  recoverAuthorizationSigner,
  verifyAuthorizationSigner,
  verifyAuthorizationForPermission,
  eip7702Digest,
} from '../src/index.js';
import { AgentPermission } from '@ban/schemas';
import { BANError } from '@ban/shared';

/**
 * Signer recovery test — we need a real signing pair to prove recovery works
 * end-to-end. The digest is the RAW EIP-7702 authorization hash (no
 * personal-sign prefix), so we sign with `account.sign({ hash })` and use
 * the returned 65-byte hex signature directly — in viem v2 `account.sign`
 * already returns the canonical `0x…` 65-byte signature, exactly what a viem
 * `signAuthorization`-style flow produces and what `recoverAddress` expects.
 * Fully hermetic (no network).
 */
import { privateKeyToAccount } from 'viem/accounts';

const USER_KEY_HEX = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
const USER_KEY = USER_KEY_HEX as `0x${string}`;
const USER_ADDR = privateKeyToAccount(USER_KEY).address;

function makeAuth() {
  return {
    chainId: 56,
    address: '0x3333333333333333333333333333333333333333',
    nonce: 1n,
    yParity: 0,
    r: 0n,
    s: 0n,
  };
}

/** Produce the 65-byte hex signature over the raw eip7702Digest(auth). */
async function signFor(auth: ReturnType<typeof makeAuth>) {
  const account = privateKeyToAccount(USER_KEY);
  return account.sign({ hash: eip7702Digest(auth) });
}

function makePermission(overrides: Partial<Record<string, unknown>> = {}): AgentPermission {
  const now = Date.now();
  return {
    id: 'perm_test',
    agentId: 'agent_1',
    userId: 'user_1',
    userAddress: USER_ADDR,
    jobId: 'job_1',
    capabilities: ['PROPOSE_SWAP'],
    allowedProtocols: ['pancakeswap'],
    allowedContracts: ['0x2222222222222222222222222222222222222222'],
    allowedFunctions: ['swapExactTokensForTokens'],
    allowedTokens: ['BNB'],
    spend: {
      spendLimit: '1000000000000000000000000',
      perTransactionCap: '10000000000000000000000',
      used: '0',
      asset: 'BNB',
    },
    validAfter: new Date(now - 1000).toISOString(),
    validUntil: new Date(now + 3600_000).toISOString(),
    nonce: '1',
    onchainRegistryReference: null,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('recoverAuthorizationSigner', () => {
  it('recovers the exact user EOA from a valid signature', async () => {
    const auth = makeAuth();
    const sig = await signFor(auth);
    const recovered = await recoverAuthorizationSigner(auth, sig);
    expect(recovered.toLowerCase()).toBe(USER_ADDR.toLowerCase());
  });

  it('rejects a malformed signature (fail-closed)', async () => {
    await expect(recoverAuthorizationSigner(makeAuth(), '0x00')).rejects.toThrow(BANError);
  });
});

describe('verifyAuthorizationSigner', () => {
  it('returns true for the correct signer, false for a mismatch', async () => {
    const auth = makeAuth();
    const sig = await signFor(auth);
    expect(await verifyAuthorizationSigner(auth, sig, USER_ADDR)).toBe(true);
    expect(await verifyAuthorizationSigner(auth, sig, '0x9999999999999999999999999999999999999999')).toBe(false);
  });
});

describe('verifyAuthorizationForPermission', () => {
  it('accepts a fresh auth signed over the permission (same nonce + chain)', async () => {
    const auth = makeAuth();
    auth.nonce = 1n; // matches permission nonce '1'
    const sig = await signFor(auth);
    expect(await verifyAuthorizationForPermission({ auth, signature: sig, permission: makePermission() })).toBe(true);
  });

  it('rejects a nonce mismatch (replay guard)', async () => {
    const auth = makeAuth();
    auth.nonce = 99n;
    const sig = await signFor(auth);
    await expect(
      verifyAuthorizationForPermission({ auth, signature: sig, permission: makePermission() }),
    ).rejects.toThrow(BANError);
  });

  it('rejects a chain id mismatch', async () => {
    const auth = makeAuth();
    auth.chainId = 97;
    const sig = await signFor(auth);
    await expect(
      verifyAuthorizationForPermission({ auth, signature: sig, permission: makePermission() }),
    ).rejects.toThrow(BANError);
  });

  it('fails closed when the permission has no resolved owner', async () => {
    const auth = makeAuth();
    const sig = await signFor(auth);
    const noOwner = makePermission({ userAddress: undefined });
    await expect(
      verifyAuthorizationForPermission({ auth, signature: sig, permission: noOwner }),
    ).rejects.toThrow(BANError);
  });
});