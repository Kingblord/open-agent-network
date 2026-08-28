import { describe, expect, it } from 'vitest';
import type { ActionProposal, Agent, Session, SpendLedgerEntry } from '@ban/schemas';
import {
  DeterministicPolicyEngine,
  InMemorySpendLedgerRepository,
  type PolicyEngineDependencies,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = Date.now();

function futureISO(hours: number): string {
  return new Date(NOW + hours * 3600_000).toISOString();
}

function actionProposal(over: Partial<ActionProposal> = {}): ActionProposal {
  return {
    proposalId: 'prop_1',
    agentId: 'agent_1',
    userId: 'user_1',
    strategyId: 'strat_default',
    sessionId: 'session_1',
    protocol: 'pancake',
    contract: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
    function: 'swapExactTokensForTokens',
    action: 'SWAP',
    capabilityId: 'swap',
    token: '0x55d398326f99059fF775246999027b3197955',
    amount: '1000000000000000000',
    estimatedValue: '1000000000000000000',
    asset: 'USDT',
    idempotencyKey: 'key-1',
    riskLevel: 'LOW',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    name: 'test agent',
    ownerId: 'user_1',
    type: 'yield',
    strategyId: 'strat_default',
    walletAddress: '0xabc',
    status: 'ACTIVE',
    capabilities: [{ id: 'swap', name: 'swap', actions: ['SWAP', 'TRANSFER'] }],
    protocols: ['pancake'],
    riskLevel: 'LOW',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    sessionId: 'session_1',
    agentId: 'agent_1',
    walletAddress: '0xwallet',
    sessionKeyReference: 'sk',
    allowedContracts: ['0x10ed43c718714eb63d5aa57b78b54704e256024e'],
    allowedFunctions: ['swapExactTokensForTokens'],
    allowedTokens: ['0x55d398326f99059ff775246999027b3197955'],
    spendCap: '5000000000000000000', // 5
    perTransactionCap: '2000000000000000000', // 2
    expiresAt: futureISO(24),
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const CONTEXT = { agentId: 'agent_1', userId: 'user_1' };

function buildEngine(
  a: Agent,
  s: Session,
  hooks: Pick<PolicyEngineDependencies, 'riskValidator' | 'strategyValidator' | 'policyVersion' | 'logger'> = {}
) {
  const ledger = new InMemorySpendLedgerRepository();
  const engine = new DeterministicPolicyEngine({
    getAgent: async () => a,
    getSession: async () => s,
    spendLedger: ledger,
    ...hooks,
  });
  return { engine, ledger };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeterministicPolicyEngine', () => {
  const a = agent();
  const s = session();

  it('ALLOWs a valid proposal and reserves spend', async () => {
    const { engine, ledger } = buildEngine(a, s);
    const proposal = actionProposal();
    const decision = await engine.validateAction(proposal, { agentId: a.id, userId: 'user_1' });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.reservationId).toBeDefined();
    expect(decision.checks.every((c) => c.passed)).toBe(true);
    expect(await ledger.reservedTotal(s.sessionId)).toBe(1000000000000000000n);
  });

  it('DENYs an invalid capability', async () => {
    const { engine } = buildEngine(a, s);
    const proposal = actionProposal({ capabilityId: 'unknown-cap' });
    const decision = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('capability');
  });

  it('DENYs an invalid protocol', async () => {
    const { engine } = buildEngine(a, s);
    const proposal = actionProposal({ protocol: 'uniswap' });
    const decision = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('protocol-allowed');
  });

  it('DENYs an expired session', async () => {
    const { engine } = buildEngine(a, session({ expiresAt: futureISO(-1) }));
    const decision = await engine.validateAction(actionProposal(), { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('session-active');
  });

  it('DENYs a revoked session', async () => {
    const { engine } = buildEngine(a, session({ status: 'REVOKED' }));
    const decision = await engine.validateAction(actionProposal(), { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('session-active');
  });

  it('DENYs cumulative spend cap exceeded (per-tx cap not hit)', async () => {
    // Isolate the cumulative-spend check: per-tx cap is high enough that ONLY
    // the cumulative cap (10 > spendCap 5) is exceeded.
    const { engine } = buildEngine(a, session({ perTransactionCap: '20000000000000000000' }));
    const proposal = actionProposal({ estimatedValue: '10000000000000000000' }); // 10 > 5 cap
    const decision = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('cumulative-spend');
  });

  it('DENYs when concurrent reservation + request exceeds cumulative cap', async () => {
    // Each value is within the per-tx cap, but the FIRST is reserved so the
    // SECOND pushes reserved+committed over the cumulative cap.
    const { engine } = buildEngine(a, session({ perTransactionCap: '4000000000000000000' }));
    const first = actionProposal({ proposalId: 'prop_a', idempotencyKey: 'key-a', estimatedValue: '4000000000000000000' }); // 4 <= perTx, 4 <= cap
    const second = actionProposal({ proposalId: 'prop_b', idempotencyKey: 'key-b', estimatedValue: '2000000000000000000' }); // 2 <= perTx, 4+2=6 > cap
    const d1 = await engine.validateAction(first, { agentId: 'agent_1', userId: 'user_1' });
    expect(d1.decision).toBe('ALLOW');
    const d2 = await engine.validateAction(second, { agentId: 'agent_1', userId: 'user_1' });
    expect(d2.decision).toBe('DENY');
    expect(d2.deniedCheck).toBe('cumulative-spend');
  });

  it('rejects a duplicate proposal after its reservation is finalized (idempotency)', async () => {
    // In-flight replays of a RESERVED proposal are idempotent (ALLOW). Once the
    // reservation is COMMITTED, re-submitting the same idempotencyKey must DENY.
    const { engine, ledger } = buildEngine(a, s);
    const proposal = actionProposal();
    const d1 = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(d1.decision).toBe('ALLOW');
    await ledger.commit(proposal.idempotencyKey); // finalize the reservation
    const d2 = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(d2.decision).toBe('DENY');
    expect(d2.deniedCheck).toBe('idempotency');
  });

  it('idempotently replays an in-flight RESERVED proposal as ALLOW', async () => {
    const { engine } = buildEngine(a, s);
    const proposal = actionProposal();
    const d1 = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(d1.decision).toBe('ALLOW');
    // Same idempotencyKey while still RESERVED -> same ALLOW, no double reserve.
    const d2 = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(d2.decision).toBe('ALLOW');
  });

  it('commits a reservation on success', async () => {
    const { engine, ledger } = buildEngine(a, s);
    const proposal = actionProposal();
    await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    await ledger.commit(proposal.idempotencyKey);
    expect((await ledger.getByIdempotency(proposal.idempotencyKey))?.status).toBe('COMMITTED');
    expect(await ledger.reservedTotal(s.sessionId)).toBe(0n);
    expect(await ledger.reservedAndCommittedTotal(s.sessionId)).toBe(1000000000000000000n);
  });

  it('releases a reservation on definitive failure', async () => {
    const { engine, ledger } = buildEngine(a, s);
    const proposal = actionProposal();
    await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    await ledger.release(proposal.idempotencyKey);
    const e = await ledger.getByIdempotency(proposal.idempotencyKey);
    expect(e?.status).toBe('RELEASED');
    expect(await ledger.reservedAndCommittedTotal(s.sessionId)).toBe(0n);
  });

  it('retains a reservation when tx state is unknown (hold)', async () => {
    const { engine, ledger } = buildEngine(a, s);
    const proposal = actionProposal();
    await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    await ledger.hold(proposal.idempotencyKey);
    const e = await ledger.getByIdempotency(proposal.idempotencyKey);
    expect(e?.status).toBe('RESERVED');
    expect(await ledger.reservedTotal(s.sessionId)).toBe(1000000000000000000n);
  });

  it('fails closed when proposal risk is missing', async () => {
    const { engine } = buildEngine(a, s);
    const proposal = actionProposal({ riskLevel: undefined });
    const decision = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('risk-level');
  });

  it('DENYs incompatible risk (MEDIUM proposal, LOW agent)', async () => {
    const { engine } = buildEngine(a, s);
    const proposal = actionProposal({ riskLevel: 'MEDIUM' });
    const decision = await engine.validateAction(proposal, { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('risk-level');
  });

  it('DENYs when risk validator rejects', async () => {
    const { engine } = buildEngine(a, s, {
      riskValidator: async () => ({ passed: false, reason: 'risk rejected' }),
    });
    const decision = await engine.validateAction(actionProposal(), { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('risk-validator');
  });

  it('DENYs when strategy validator rejects', async () => {
    const { engine } = buildEngine(a, s, {
      strategyValidator: async () => ({ passed: false, reason: 'strategy rejected' }),
    });
    const decision = await engine.validateAction(actionProposal(), { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.deniedCheck).toBe('strategy-validator');
  });

  it('approves after all checks (success path)', async () => {
    const { engine } = buildEngine(a, s);
    const decision = await engine.validateAction(actionProposal(), { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('ALLOW');
  });

  it('produces deterministic denial reasons with policy version', async () => {
    const { engine } = buildEngine(a, s, { policyVersion: '2.1.0' });
    const decision = await engine.validateAction(actionProposal({ riskLevel: 'HIGH' }), { agentId: 'agent_1', userId: 'user_1' });
    expect(decision.decision).toBe('DENY');
    expect(decision.policyVersion).toBe('2.1.0');
    expect(decision.deniedCheck).toBe('risk-level');
    expect(decision.reason).toContain('HIGH');
    expect(decision.checks).toBeDefined();
  });
});