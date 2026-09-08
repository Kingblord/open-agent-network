import { describe, it, expect, beforeEach } from 'vitest';
import { __auditThrottle, auditEventType } from '../lib/agent-runtime/persistence';

/**
 * Firestore write-throttle regression test.
 *
 * The Inngest loop + a STUCK executor were writing AGENT_TICK heartbeats and
 * AGENT_EXECUTION_PENDING with the SAME note every ~2 minutes — dozens of
 * identical audit rows/hour/agent — exhausting the free-tier 20k/day write
 * quota. The throttle must suppress repeats of the same (type, agent, note)
 * for 5 minutes while never suppressing a distinct reason.
 */

describe('audit write throttle (FIRESTORE quota)', () => {
  beforeEach(() => __auditThrottle.reset());

  it('first AGENT_TICK is written; a repeat within the window is throttled', () => {
    const detail = { source: 'inngest-loop', cycleResult: { ok: true, stage: 'decided' } };
    expect(__auditThrottle.shouldThrottle('AGENT_TICK', 'ag_test', detail)).toBe(false);
    // Same agent + same signature → suppressed
    expect(__auditThrottle.shouldThrottle('AGENT_TICK', 'ag_test', detail)).toBe(true);
  });

  it("a DIFFERENT agent is never throttled by another agent's heartbeat", () => {
    expect(__auditThrottle.shouldThrottle('AGENT_TICK', 'ag_a', {})).toBe(false);
    expect(__auditThrottle.shouldThrottle('AGENT_TICK', 'ag_b', {})).toBe(false);
  });

  it("a STUCK executor's repeated PENDING note is throttled, but a changed note writes again", () => {
    const stuck = { note: 'Execution pending — same error every cycle (stuck).' };
    expect(__auditThrottle.shouldThrottle('AGENT_EXECUTION_PENDING', 'ag_test', stuck)).toBe(false);
    expect(__auditThrottle.shouldThrottle('AGENT_EXECUTION_PENDING', 'ag_test', stuck)).toBe(true);
    // The reason CHANGED → a new distinct signature → must write.
    const changed = { note: 'Execution pending — NEW error reason.' };
    expect(__auditThrottle.shouldThrottle('AGENT_EXECUTION_PENDING', 'ag_test', changed)).toBe(false);
  });

  it('never throttles state-changing events (observed/decision/confirmed)', () => {
    expect(__auditThrottle.shouldThrottle('AGENT_OBSERVED', 'ag_test', {})).toBe(false);
    expect(__auditThrottle.shouldThrottle('AGENT_OBSERVED', 'ag_test', {})).toBe(false);
    expect(__auditThrottle.shouldThrottle('AI_DECISION_CREATED', 'ag_test', {})).toBe(false);
    expect(__auditThrottle.shouldThrottle('TRANSACTION_CONFIRMED', 'ag_test', {})).toBe(false);
  });

  it('auditEventType preserves the string for any known event name', () => {
    expect(auditEventType('AGENT_OBSERVED')).toBe('AGENT_OBSERVED');
    expect(auditEventType('TRANSACTION_CONFIRMED')).toBe('TRANSACTION_CONFIRMED');
  });
});