import { describe, it, expect } from 'vitest';
import type { ActionProposal, Session } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { ContractRegistry, TokenRegistry } from '@ban/registry';
import { SessionSigner, SessionAuthorityResolver, type SignedTransaction } from '../src/index.js';

const ADDR_ROUTER = '0x1111111111111111111111111111111111111111';
const ADDR_TOKEN_IN = '0x2222222222222222222222222222222222222222';
const ADDR_TOKEN_OUT = '0x3333333333333333333333333333333333333333';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'sess_test',
    agentId: 'agent_1',
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sessionKeyReference: 'key-ref-1',
    allowedContracts: [ADDR_ROUTER],
    allowedFunctions: ['swapExactTokensForTokens', 'getAmountsOut'],
    allowedTokens: ['BNB', 'USDT', ADDR_TOKEN_IN, ADDR_TOKEN_OUT],
    spendCap: '1000000000000000000000', // 1000 token units
    perTransactionCap: '100000000000000000000', // 100 token units
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'ACTIVE',
    onchainRegistryReference: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    proposalId: 'proposal_1',
    agentId: 'agent_1',
    userId: 'user_1',
    sessionId: 'sess_test',
    protocol: 'pancakeswap',
    contract: ADDR_ROUTER,
    function: 'swapExactTokensForTokens',
    action: 'SWAP',
    capabilityId: 'PROPOSE_SWAP',
    token: 'BNB',
    amount: '1000000000000000000', // 1 unit
    estimatedValue: '1000000000000000000',
    asset: 'BNB',
    params: { calldata: '0xabcdef', chainId: 56 },
    idempotencyKey: 'swap:1',
    nonce: '1',
    riskLevel: 'LOW',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SessionAuthorityResolver', () => {
  it('resolves an ACTIVE, unexpired, matching session', () => {
    const r = new SessionAuthorityResolver();
    expect(() => r.resolve(makeProposal(), makeSession())).not.toThrow();
  });

  it('rejects a sessionId mismatch', () => {
    const r = new SessionAuthorityResolver();
    const p = makeProposal({ sessionId: 'sess_other' });
    expect(() => r.resolve(p, makeSession())).toThrowError(ErrorCode.SESSION_REVOKED);
  });

  it('rejects a non-ACTIVE session', () => {
    const r = new SessionAuthorityResolver();
    expect(() => r.resolve(makeProposal(), makeSession({ status: 'REVOKED' }))).toThrowError(ErrorCode.SESSION_REVOKED);
  });

  it('rejects an expired session', () => {
    const r = new SessionAuthorityResolver();
    const s = makeSession({ expiresAt: new Date(Date.now() - 10_000).toISOString() });
    expect(() => r.resolve(makeProposal(), s)).toThrowError(ErrorCode.SESSION_EXPIRED);
  });
});

describe('SessionSigner', () => {
  const devBackend = async (): Promise<SignedTransaction> => ({
    signature: '0x' + 'ab'.repeat(64) + '1c',
    backend: 'dev',
    signedAt: new Date().toISOString(),
  });

  it('signs an in-session proposal (positive path)', async () => {
    const signer = new SessionSigner(devBackend);
    const signed = await signer.sign(makeProposal(), { session: makeSession() });
    expect(signed.signature).toMatch(/^0x/);
    expect(signed.backend).toBe('dev');
  });

  it('rejects a contract outside the session allowlist', async () => {
    const signer = new SessionSigner(devBackend);
    const p = makeProposal({ contract: '0x9999999999999999999999999999999999999999' });
    await expect(signer.sign(p, { session: makeSession() })).rejects.toThrowError(ErrorCode.CONTRACT_NOT_ALLOWED);
  });

  it('rejects a function outside the session allowlist', async () => {
    const signer = new SessionSigner(devBackend);
    const p = makeProposal({ function: 'selfdestruct' });
    await expect(signer.sign(p, { session: makeSession() })).rejects.toThrowError(ErrorCode.FUNCTION_NOT_ALLOWED);
  });

  it('rejects a token outside the session allowlist', async () => {
    const signer = new SessionSigner(devBackend);
    const p = makeProposal({ token: 'SHIB' });
    await expect(signer.sign(p, { session: makeSession() })).rejects.toThrowError(ErrorCode.TOKEN_NOT_ALLOWED);
  });

  it('rejects an amount above the per-transaction cap', async () => {
    const signer = new SessionSigner(devBackend);
    const p = makeProposal({ amount: '999999999999999999999' }); // > 100 cap
    await expect(signer.sign(p, { session: makeSession() })).rejects.toThrowError(ErrorCode.SPEND_LIMIT_EXCEEDED);
  });

  it('rejects when the registry says the contract/function is not EXECUTE-capable', async () => {
    const contracts = new ContractRegistry({
      chainId: 56,
      contracts: [
        {
          id: 'pcs-router',
          chainId: 56,
          address: ADDR_ROUTER,
          protocolId: 'pancakeswap',
          name: 'PancakeSwap Router',
          verified: true,
          enabled: true,
          functions: [
            { signature: 'getAmountsOut(uint256,address[])', name: 'getAmountsOut', capability: 'READ_ONLY' },
          ],
        },
      ],
    });
    const signer = new SessionSigner(devBackend);
    // swapExactTokensForTokens is in the session allowlist but NOT EXECUTE-capable in the registry
    await expect(signer.sign(makeProposal(), { session: makeSession(), contracts })).rejects.toThrowError(ErrorCode.CONTRACT_NOT_ALLOWED);
  });

  it('rejects when the registry says the token is not verified/enabled', async () => {
    const tokens = new TokenRegistry({
      chainId: 56,
      tokens: [
        { id: 'bnb', chainId: 56, address: ADDR_TOKEN_IN, symbol: 'BNB', name: 'BNB', decimals: 18, verified: true, enabled: false },
      ],
    });
    const signer = new SessionSigner(devBackend);
    await expect(signer.sign(makeProposal(), { session: makeSession(), tokens })).rejects.toThrowError(ErrorCode.TOKEN_NOT_ALLOWED);
  });

  it('refuses to fabricate a signature when no backend is configured', async () => {
    const signer = new SessionSigner(null);
    await expect(signer.sign(makeProposal(), { session: makeSession() })).rejects.toThrowError(/refusing to fabricate/);
  });

  it('refuses an empty/blank signature from the backend', async () => {
    const signer = new SessionSigner(async () => ({ signature: '', backend: 'bad', signedAt: new Date().toISOString() }));
    await expect(signer.sign(makeProposal(), { session: makeSession() })).rejects.toThrowError(ErrorCode.EXECUTION_FAILED);
  });
});