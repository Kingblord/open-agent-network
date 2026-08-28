import { describe, it, expect, beforeEach } from 'vitest';
import {
  GenericExecutionEngine,
  type ExecutionContext,
  type ExecutionEngineDependencies,
} from '../src/index.js';
import type { ActionProposal, Execution, Session } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';

/**
 * M8 — Generic Execution Engine.
 *
 * Deterministic, framework-agnostic unit suite. All dependencies are in-memory
 * fakes (Rule 7). No RPC/Altana/private keys/Firestore/external services are
 * touched. Proves the execution state machine + safety boundaries.
 */

// ---------------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------------

function makeProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    proposalId: 'proposal_test_1234567890abcdef',
    agentId: 'agent_1',
    userId: 'user_1',
    sessionId: 'session_1',
    protocol: 'pancake',
    contract: '0xcontract',
    function: 'swap',
    action: 'SWAP',
    capabilityId: 'PROPOSE_SWAP',
    token: 'BNB',
    amount: '1000',
    estimatedValue: '1000',
    asset: 'BNB',
    params: { amountOutMin: 0, path: ['BNB', 'BUSD'] },
    idempotencyKey: 'ik_1',
    nonce: '1',
    riskLevel: 'LOW',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeActiveSession(overrides: Partial<ExecutionContext['session']> = {}) {
  return {
    sessionId: 'session_1',
    agentId: 'agent_1',
    walletAddress: '0xwallet',
    sessionKeyReference: 'key-ref',
    allowedContracts: ['0x1111'],
    allowedFunctions: ['swap'],
    allowedTokens: ['BNB'],
    spendCap: '1000000',
    perTransactionCap: '5000',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'ACTIVE',
    onchainRegistryReference: 'ref-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    agentId: 'agent_1',
    userId: 'user_1',
    correlationId: 'corr_1',
    session: makeActiveSession(),
    ...overrides,
  };
}

/** In-memory store + dependency set (reset per test). */
class InMemoryStore {
  executions = new Map<string, Execution>();
  submitCalls = 0;
  reconcileCalls = 0;
  submitShouldThrow: Error | null = null;
  reconcileResult: { status: Execution['status']; errorCode?: string | null } = { status: 'CONFIRMED' };

  deps: ExecutionEngineDependencies = {
    persistExecution: async (exec) => {
      this.executions.set(exec.executionId, exec);
    },
    getExecution: async (id) => this.executions.get(id) ?? null,
    submitTransaction: async (input) => {
      this.submitCalls += 1;
      if (this.submitShouldThrow) throw this.submitShouldThrow;
      return { transactionHash: '0xtx_' + input.proposal.proposalId.slice(-8), gasUsed: '21000' };
    },
    reconcileExecution: async (input) => {
      this.reconcileCalls += 1;
      return this.reconcileResult;
    },
  };
}

let engine: GenericExecutionEngine;
let store: InMemoryStore;

beforeEach(() => {
  store = new InMemoryStore();
  engine = new GenericExecutionEngine(store.deps);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GenericExecutionEngine', () => {
  it('APPROVED -> PROPOSED -> EXECUTING -> CONFIRMING -> CONFIRMED', async () => {
    const proposal = makeProposal();
    const ctx = makeContext();

    const seen: string[] = [];
    const realPersist = store.deps.persistExecution;
    store.deps.persistExecution = async (exec) => {
      seen.push(exec.status);
      await realPersist(exec);
    };

    const result = await engine.execute(proposal, ctx);

    expect(result.status).toBe('CONFIRMED');
    expect(result.executionId).toBe(executionIdFor(proposal.proposalId));
    expect(result.transactionHash).toBe('0xtx_' + proposal.proposalId.slice(-8));
    expect(result.chainId).toBe(97);
    // Persisted sequence includes PROPOSED -> EXECUTING -> CONFIRMING -> CONFIRMED
    expect(seen).toContain('PROPOSED');
    expect(seen).toContain('EXECUTING');
    expect(seen).toContain('CONFIRMING');
    expect(seen).toContain('CONFIRMED');
    expect(store.submitCalls).toBe(1);
  });

  it('deduces parametersHash deterministically from proposal.params', async () => {
    const p1 = makeProposal({ params: { a: 1, b: 2 } });
    const p2 = makeProposal({ params: { a: 1, b: 2 } });
    const r1 = await engine.execute(p1, makeContext());
    store.executions.clear();
    const r2 = await engine.execute(p2, makeContext());
    expect(r1.parametersHash).toBe(r2.parametersHash);
    expect(r1.parametersHash).toBe(JSON.stringify({ a: 1, b: 2 }));
  });

  it('inactive/revoked session -> SESSION_REVOKED, no submit', async () => {
    const ctx = makeContext({ session: makeActiveSession({ status: 'REVOKED' }) });
    await expect(engine.execute(makeProposal(), ctx)).rejects.toMatchObject({ code: 'ERR_SESSION_REVOKED' });
    expect(store.submitCalls).toBe(0);
    const stored = store.executions.get(executionIdFor(makeProposal().proposalId));
    expect(stored?.status).toBe('FAILED');
    expect(stored?.errorCode).toBe('ERR_SESSION_REVOKED');
  });

  it('preflight rejection stops execution before submit', async () => {
    const deps: ExecutionEngineDependencies = {
      ...store.deps,
      preflight: { simulate: async () => ({ approved: false, reason: 'Slippage too high' }) },
    };
    const preflightEngine = new GenericExecutionEngine(deps);
    await expect(preflightEngine.execute(makeProposal(), makeContext())).rejects.toMatchObject({
      code: 'ERR_POLICY_DENIED',
      message: expect.stringContaining('Slippage too high'),
    });
    expect(store.submitCalls).toBe(0);
  });

  it('successful preflight proceeds to submit', async () => {
    const deps: ExecutionEngineDependencies = { ...store.deps, preflight: { simulate: async () => ({ approved: true }) } };
    const preflightEngine = new GenericExecutionEngine(deps);
    const result = await preflightEngine.execute(makeProposal(), makeContext());
    expect(result.status).toBe('CONFIRMED');
    expect(store.submitCalls).toBe(1);
  });

  it('submit failure -> FAILED + deterministic errorCode, no crash on caller', async () => {
    store.submitShouldThrow = new BANError(ErrorCode.SLIPPAGE_VIOLATION, 'price moved');
    await expect(engine.execute(makeProposal(), makeContext())).rejects.toMatchObject({ code: 'ERR_SLIPPAGE_VIOLATION' });
    const stored = store.executions.get(executionIdFor(makeProposal().proposalId));
    expect(stored?.status).toBe('FAILED');
    expect(stored?.errorCode).toBe('ERR_SLIPPAGE_VIOLATION');
  });

  it('reconciliation success -> CONFIRMED', async () => {
    store.reconcileResult = { status: 'CONFIRMED' };
    const result = await engine.execute(makeProposal(), makeContext());
    expect(result.status).toBe('CONFIRMED');
    expect(store.reconcileCalls).toBe(1);
  });

  it('already CONFIRMED execution cannot be submitted again', async () => {
    // Execute to CONFIRMED
    await engine.execute(makeProposal(), makeContext());
    expect(store.submitCalls).toBe(1);
    // Second call for the SAME proposal id -> idempotent no-op, no new submit
    const result = await engine.execute(makeProposal(), makeContext());
    expect(result.status).toBe('CONFIRMED');
    expect(store.submitCalls).toBe(1);
  });

  it('duplicate proposal/execution ID is idempotently rejected (EXECUTING w/o hash)', async () => {
    // Manually place an EXECUTING entry with no tx hash (crash orphan)
    const proposal = makeProposal();
    const executionId = executionIdFor(proposal.proposalId);
    store.executions.set(executionId, {
      executionId,
      proposalId: proposal.proposalId,
      agentId: 'agent_1',
      userId: 'user_1',
      protocol: proposal.protocol,
      contract: proposal.contract,
      function: proposal.function,
      parametersHash: 'x',
      transactionHash: null,
      chainId: 97,
      gasUsed: null,
      status: 'EXECUTING',
      errorCode: null,
      createdAt: new Date().toISOString(),
      confirmedAt: null,
    });
    await expect(engine.execute(proposal, makeContext())).rejects.toMatchObject({ code: 'ERR_DUPLICATE_PROPOSAL' });
    expect(store.submitCalls).toBe(0);
  });

  it('reconciliation cannot cause a second transaction submission', async () => {
    // Execute to CONFIRMED, then reconcile() must only reconcile, never submit.
    const proposal = makeProposal();
    const before = store.submitCalls;
    await engine.execute(proposal, makeContext());
    expect(store.submitCalls).toBe(before + 1);
    const exec = await engine.reconcile(executionIdFor(proposal.proposalId));
    expect(store.submitCalls).toBe(before + 1); // reconcile must NOT broadcast
    expect(exec.status).toBe('CONFIRMED');
  });
});

/** Mirrors the engine's deterministic executionId derivation. */
function executionIdFor(proposalId: string): string {
  return `exec_${proposalId.slice(-24)}`;
}