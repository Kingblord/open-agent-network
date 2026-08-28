import 'server-only';

import { getAdminDb, collections } from '@/lib/firebase-admin';
import { agentRegistry } from '@/lib/agent-registry';
import { FirebaseSpendLedgerRepository } from '@/lib/policy/spend-ledger-repo';
import {
  DeterministicPolicyEngine,
  type PolicyEngineDependencies,
  type SpendLedgerRepository,
} from '@ban/policy-engine';
import type { Agent, Session } from '@ban/schemas';

/**
 * M5 — app-side glue. There is ONE authoritative PolicyEngine in the repo
 * (`@ban/policy-engine`), consumed here through its package identity (no source
 * alias, no re-implementation). This module only wires the engine's
 * `PolicyEngineDependencies` to the app's Firestore-backed repositories
 * (agent registry + session read + spend ledger).
 */

async function getSession(sessionId: string): Promise<Session | null> {
  const db = getAdminDb();
  const snap = await db.collection(collections.agentSessions).doc(sessionId).get();
  return snap.exists ? (snap.data() as Session) : null;
}

export function buildPolicyEngine(spendLedger: SpendLedgerRepository = new FirebaseSpendLedgerRepository()) {
  const deps: PolicyEngineDependencies = {
    getAgent: (agentId: string) => agentRegistry.getById(agentId) as Promise<Agent | null>,
    getSession,
    spendLedger,
  };
  return new DeterministicPolicyEngine(deps);
}

/** Shared singleton so every control-plane route uses the same engine. */
export const policyEngine = buildPolicyEngine();