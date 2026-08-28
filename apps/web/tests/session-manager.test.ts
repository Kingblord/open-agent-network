import { describe, it, expect } from 'vitest';
import { SessionManager } from '@/lib/session-manager';
import { DevAltanaAdapter } from '@/lib/altana/dev-adapter';
import type { Session } from '@ban/schemas';

const WALLET = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';

function activeSession(overrides: Partial<Session> = {}): Session {
  const future = Date.now() + 60_000;
  const now = new Date().toISOString();
  return {
    sessionId: 'sess_test',
    agentId: 'ag_test',
    walletAddress: WALLET,
    sessionKeyReference: 'dev_key_test',
    allowedContracts: [CONTRACT],
    allowedFunctions: ['deposit(uint256)'],
    allowedTokens: [TOKEN],
    spendCap: '1000000000000000000', // 1 ETH
    perTransactionCap: '1000000000000000000',
    expiresAt: new Date(future).toISOString(),
    status: 'ACTIVE',
    onchainRegistryReference: 'dev_tx',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SessionManager state machine + authorization (DEV adapter)', () => {
  it('creates a scoped session in PENDING state', async () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const session = await manager.create({
      agentId: 'ag_test',
      walletAddress: WALLET,
      allowedContracts: [CONTRACT],
      allowedFunctions: ['deposit(uint256)'],
      allowedTokens: [TOKEN],
      spendCap: '1000000000000000000',
      perTransactionCap: '1000000000000000000',
      expiresAtMs: Date.now() + 60_000,
    });
    expect(session.status).toBe('PENDING');
    expect(session.sessionId).toMatch(/^sess_/);
    expect(session.onchainRegistryReference).toBeNull();
  });

  it('rejects when per-transaction cap exceeds spend cap', async () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    await expect(
      manager.create({
        agentId: 'ag_test',
        walletAddress: WALLET,
        allowedContracts: [],
        allowedFunctions: [],
        allowedTokens: [],
        spendCap: '1000',
        perTransactionCap: '2000',
        expiresAtMs: Date.now() + 60_000,
      })
    ).rejects.toThrow(/perTransactionCap/);
  });

  it('allows an authorized action', () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const res = manager.authorize(activeSession(), {
      to: CONTRACT,
      function: 'deposit(uint256)',
      token: TOKEN,
      amountWei: '100',
    });
    expect(res.decision).toBe('ALLOW');
  });

  it('denies an unauthorized contract', () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const res = manager.authorize(activeSession(), {
      to: '0x9999999999999999999999999999999999999999',
      function: 'deposit(uint256)',
      token: TOKEN,
      amountWei: '100',
    });
    expect(res.decision).toBe('DENY');
    expect(res.failedCheck).toBe('contract_denied');
  });

  it('denies an unauthorized function', () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const res = manager.authorize(activeSession(), {
      to: CONTRACT,
      function: 'withdraw(uint256)',
      token: TOKEN,
      amountWei: '100',
    });
    expect(res.decision).toBe('DENY');
    expect(res.failedCheck).toBe('function_denied');
  });

  it('denies an unauthorized token', () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const res = manager.authorize(activeSession(), {
      to: CONTRACT,
      function: 'deposit(uint256)',
      token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amountWei: '100',
    });
    expect(res.decision).toBe('DENY');
    expect(res.failedCheck).toBe('token_denied');
  });

  it('denies a per-transaction amount over the cap', () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const res = manager.authorize(activeSession(), {
      to: CONTRACT,
      function: 'deposit(uint256)',
      token: TOKEN,
      amountWei: '2000000000000000000', // 2 ETH > 1 ETH cap
    });
    expect(res.decision).toBe('DENY');
    expect(res.failedCheck).toBe('per_transaction_cap_exceeded');
  });

  it('denies a non-ACTIVE session', () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const res = manager.authorize(activeSession({ status: 'PENDING' }), {
      to: CONTRACT,
      function: 'deposit(uint256)',
      token: TOKEN,
      amountWei: '100',
    });
    expect(res.decision).toBe('DENY');
    expect(res.failedCheck).toBe('session_not_active');
  });

  it('denies an expired session', () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const expired = activeSession({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const res = manager.authorize(expired, {
      to: CONTRACT,
      function: 'deposit(uint256)',
      token: TOKEN,
      amountWei: '100',
    });
    expect(res.decision).toBe('DENY');
    expect(res.failedCheck).toBe('session_expired');
  });
});

describe('SessionManager Firestore lifecycle (DEV adapter, needs Firestore env)', () => {
  it('registers a PENDING session to ACTIVE and persists', async () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const created = await manager.create({
      agentId: 'ag_live',
      walletAddress: WALLET,
      allowedContracts: [CONTRACT],
      allowedFunctions: ['deposit(uint256)'],
      allowedTokens: [TOKEN],
      spendCap: '1000000000000000000',
      perTransactionCap: '100000000000000000',
      expiresAtMs: Date.now() + 86_400_000,
    });
    const active = await manager.registerSession(created.sessionId);
    expect(active.status).toBe('ACTIVE');
    expect(active.sessionKeyReference).toMatch(/^dev_key_/);
    expect(active.onchainRegistryReference).not.toBeNull();

    const fetched = await manager.getById(created.sessionId);
    expect(fetched?.status).toBe('ACTIVE');
  });

  it('revokes an ACTIVE session to REVOKED (terminal)', async () => {
    const manager = new SessionManager(new DevAltanaAdapter());
    const created = await manager.create({
      agentId: 'ag_live',
      walletAddress: WALLET,
      allowedContracts: [CONTRACT],
      allowedFunctions: ['deposit(uint256)'],
      allowedTokens: [TOKEN],
      spendCap: '1000000000000000000',
      perTransactionCap: '100000000000000000',
      expiresAtMs: Date.now() + 86_400_000,
    });
    await manager.registerSession(created.sessionId);
    const revoked = await manager.revokeSession(created.sessionId);
    expect(revoked.status).toBe('REVOKED');

    // A revoked session (terminal) cannot be registered again.
    await expect(manager.registerSession(created.sessionId)).rejects.toThrow();
  });
});