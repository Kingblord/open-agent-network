import { describe, it, expect } from 'vitest';
import {
  transitionOk,
  isLifecycleAction,
  LIFECYCLE_ACTIONS,
} from '@/lib/agent-registry';

/**
 * M3 - Unit tests for the AgentRegistry lifecycle state machine (pure logic,
 * no Firestore). Proves the valid/invalid transitions + terminal REVOKED
 * invariant that the API routes enforce against live Firestore.
 */
describe('agent registry lifecycle state machine', () => {
  it('exposes exactly the three supported actions', () => {
    expect(LIFECYCLE_ACTIONS).toEqual(['activate', 'pause', 'revoke']);
  });

  it('isLifecycleAction rejects unknown actions', () => {
    expect(isLifecycleAction('activate')).toBe(true);
    expect(isLifecycleAction('pause')).toBe(true);
    expect(isLifecycleAction('revoke')).toBe(true);
    expect(isLifecycleAction('deploy')).toBe(false);
    expect(isLifecycleAction(123)).toBe(false);
    expect(isLifecycleAction(null)).toBe(false);
  });

  describe('activate', () => {
    it('allows DRAFT -> ACTIVE', () => {
      expect(transitionOk('activate', 'DRAFT')).toBe(true);
    });
    it('allows PAUSED -> ACTIVE (re-activation)', () => {
      expect(transitionOk('activate', 'PAUSED')).toBe(true);
    });
    it('allows EXPIRED -> ACTIVE', () => {
      expect(transitionOk('activate', 'EXPIRED')).toBe(true);
    });
    it('rejects ACTIVATING an already-ACTIVE agent', () => {
      expect(transitionOk('activate', 'ACTIVE')).toBe(false);
    });
    it('rejects activating a REVOKED agent (terminal)', () => {
      expect(transitionOk('activate', 'REVOKED')).toBe(false);
    });
    it('rejects activating an ERROR agent', () => {
      expect(transitionOk('activate', 'ERROR')).toBe(false);
    });
  });

  describe('pause', () => {
    it('allows ACTIVE -> PAUSED', () => {
      expect(transitionOk('pause', 'ACTIVE')).toBe(true);
    });
    it('rejects pausing a DRAFT agent', () => {
      expect(transitionOk('pause', 'DRAFT')).toBe(false);
    });
    it('rejects pausing an already-PAUSED agent', () => {
      expect(transitionOk('pause', 'PAUSED')).toBe(false);
    });
    it('rejects pausing a REVOKED agent', () => {
      expect(transitionOk('pause', 'REVOKED')).toBe(false);
    });
  });

  describe('revoke', () => {
    it('allows revoking from every non-terminal state', () => {
      expect(transitionOk('revoke', 'DRAFT')).toBe(true);
      expect(transitionOk('revoke', 'ACTIVE')).toBe(true);
      expect(transitionOk('revoke', 'PAUSED')).toBe(true);
      expect(transitionOk('revoke', 'EXPIRED')).toBe(true);
      expect(transitionOk('revoke', 'ERROR')).toBe(true);
    });
    it('rejects revoking an already-REVOKED agent (REVOKED is terminal)', () => {
      expect(transitionOk('revoke', 'REVOKED')).toBe(false);
    });
  });

  describe('REVOKED terminality', () => {
    it('no action can transition out of REVOKED', () => {
      for (const action of LIFECYCLE_ACTIONS) {
        expect(transitionOk(action, 'REVOKED')).toBe(false);
      }
    });
  });
});