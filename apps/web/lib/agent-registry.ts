import 'server-only';

import { z } from 'zod';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { generateId, BANError, ErrorCode } from '@ban/shared';
import { AgentSchema, type Agent, type AgentStatus } from '@ban/schemas';

const logger = createStructuredLogger('agents.registry');

/**
 * M3 - BAN Agent Registry (single source of truth for the `agents` collection).
 *
 * This is the authoritative control-plane registry. It owns agent identity,
 * type/strategy, capabilities, lifecycle state, wallet/session references and
 * execution-relevant configuration. Nothing else (marketplace presentation
 * metadata, UI state, etc.) may override registry identity, capabilities or
 * lifecycle state.
 *
 * NO strategy-specific code lives here: `type` / `strategyId` are treated as
 * opaque references, so the registry never has to know about yield, LP, health
 * factor, grids, etc.
 *
 * Lifecycle is a server-side state machine with invariant checks. REVOKED is
 * terminal and can never transition back.
 */

function agentRef(db: FirebaseFirestore.Firestore, agentId: string) {
  return db.collection(collections.agents).doc(agentId);
}

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

export type LifecycleAction = 'activate' | 'pause' | 'revoke';

interface Transition {
  from: AgentStatus[];
  to: AgentStatus;
  audit: string;
}

const TRANSITIONS: Record<LifecycleAction, Transition> = {
  activate: {
    from: ['DRAFT', 'PAUSED', 'EXPIRED'],
    to: 'ACTIVE',
    audit: 'AGENT_ACTIVATED',
  },
  pause: {
    from: ['ACTIVE'],
    to: 'PAUSED',
    audit: 'AGENT_PAUSED',
  },
  revoke: {
    // REVOKED is terminal: it appears in no `from` list so it can never be a source.
    from: ['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ERROR'],
    to: 'REVOKED',
    audit: 'AGENT_REVOKED',
  },
};

export const LIFECYCLE_ACTIONS = Object.keys(TRANSITIONS) as LifecycleAction[];

export function isLifecycleAction(value: unknown): value is LifecycleAction {
  return typeof value === 'string' && (TRANSITIONS as Record<string, unknown>)[value] !== undefined;
}

/** Pure state-machine validity check (unit-testable without Firestore). */
export function transitionOk(action: LifecycleAction, current: AgentStatus): boolean {
  const t = TRANSITIONS[action];
  return t ? t.from.includes(current) : false;
}

// ---------------------------------------------------------------------------
// Input schemas (registry-owned fields excluded; set by the registry)
// ---------------------------------------------------------------------------

/** Fields a caller may supply on create. id/status/createdAt/updatedAt are managed. */
const AgentCreateInputSchema = AgentSchema.omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export type AgentCreateInput = z.infer<typeof AgentCreateInputSchema>;

/** Non-lifecycle metadata an owner may PATCH. Status/owner/wallet/type are immutable. */
const AgentMetadataPatchSchema = AgentSchema.omit({
  id: true,
  ownerId: true,
  status: true,
  walletAddress: true,
  type: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type AgentMetadataPatch = z.infer<typeof AgentMetadataPatchSchema>;

// ---------------------------------------------------------------------------
// State-machine + readiness guards
// ---------------------------------------------------------------------------

function assertTransitionAllowed(agent: Agent, action: LifecycleAction) {
  const t = TRANSITIONS[action];
  if (!t.from.includes(agent.status)) {
    const terminalNote = t.to === 'REVOKED' ? ' (REVOKED is terminal)' : '';
    throw new BANError(
      ErrorCode.AGENT_INACTIVE,
      `Invalid transition: cannot ${action} an agent in state ${agent.status}${terminalNote}`,
      { correlationId: getCorrelationId() }
    );
  }
}

function assertActivationReady(agent: Agent) {
  if (agent.capabilities.length === 0) {
    throw new BANError(ErrorCode.AGENT_INACTIVE, 'Activation requires at least one capability', {
      correlationId: getCorrelationId(),
    });
  }
  if (!agent.strategyId) {
    throw new BANError(ErrorCode.AGENT_INACTIVE, 'Activation requires a strategy binding', {
      correlationId: getCorrelationId(),
    });
  }
  if (!agent.walletAddress) {
    throw new BANError(ErrorCode.AGENT_INACTIVE, 'Activation requires a configured wallet address', {
      correlationId: getCorrelationId(),
    });
  }
}

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------

function writeAgentAuditEvent(entry: {
  eventType: string;
  agentId: string;
  correlationId: string;
  actorId: string;
  from: AgentStatus;
  to: AgentStatus;
}) {
  const db = getAdminDb();
  return db.collection(collections.auditEvents).add({
    eventId: generateId('evt'),
    eventType: entry.eventType,
    agentId: entry.agentId,
    correlationId: entry.correlationId,
    actorId: entry.actorId,
    payload: { from: entry.from, to: entry.to },
    createdAt: new Date().toISOString(),
  });
}

export class AgentRegistry {
  /**
   * Create a new agent in the authoritative `agents` collection. Always starts
   * DRAFT; activation is an explicit lifecycle action. The acting developer is
   * forced to be the recorded owner (identity cannot be spoofed).
   */
  async create(input: AgentCreateInput, actingDeveloperId: string): Promise<Agent> {
    const parsed = AgentCreateInputSchema.safeParse({ ...input, ownerId: actingDeveloperId });
    if (!parsed.success) {
      throw new BANError(
        ErrorCode.SCHEMA_INVALID,
        'Invalid agent payload: ' + parsed.error.message,
        { correlationId: getCorrelationId() }
      );
    }
    const db = getAdminDb();
    const id = generateId('ag');
    const now = new Date().toISOString();
    const agent: Agent = {
      ...parsed.data,
      id,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
    };
    await agentRef(db, id).set(agent);
    logger.info('agent_created', { agentId: id, ownerId: agent.ownerId });
    return agent;
  }

  /** Fetch a single agent (the authoritative record). */
  async getById(id: string): Promise<Agent | null> {
    const db = getAdminDb();
    const snap = await agentRef(db, id).get();
    return snap.exists ? (snap.data() as Agent) : null;
  }

  /**
   * List agents, optionally scoped by owner and/or lifecycle status.
   *
   * NOTE: we deliberately avoid `.orderBy()` inside the Firestore query.
   * Combining an equality filter with an `orderBy` on another field requires a
   * manually-deployed Firestore composite index (the FAILED_PRECONDITION the
   * app was hitting on /api/agents). Instead we filter with plain equality and
   * sort + cap in memory, which returns the same result with no console
   * dependency.
   */
  async list(options: { ownerId?: string; status?: AgentStatus; limit?: number } = {}): Promise<Agent[]> {
    const db = getAdminDb();
    const limit = Math.min(options.limit ?? 50, 100);
    let q: FirebaseFirestore.Query = db.collection(collections.agents);
    if (options.ownerId) q = q.where('ownerId', '==', options.ownerId);
    if (options.status) q = q.where('status', '==', options.status);
    const snap = await q.get();
    const items: Agent[] = [];
    snap.forEach((doc) => items.push(doc.data() as Agent));
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return items.slice(0, limit);
  }

  /**
   * Update metadata only. Lifecycle status is intentionally immutable here
   * (driven only via lifecycle()). OwnerId and wallet are also immutable.
   */
  async updateMetadata(id: string, patch: AgentMetadataPatch, actorId: string): Promise<Agent | null> {
    const parsed = AgentMetadataPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new BANError(
        ErrorCode.SCHEMA_INVALID,
        'Invalid metadata patch: ' + parsed.error.message,
        { correlationId: getCorrelationId() }
      );
    }
    const db = getAdminDb();
    const ref = agentRef(db, id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const existing = snap.data() as Agent;
    if (existing.ownerId !== actorId) {
      throw new BANError(ErrorCode.POLICY_DENIED, 'Not authorized to modify this agent', {
        correlationId: getCorrelationId(),
      });
    }
    await ref.update({ ...parsed.data, updatedAt: new Date().toISOString() });
    const updated = (await ref.get()).data() as Agent;
    logger.info('agent_metadata_updated', { agentId: id, actorId });
    return updated;
  }

  /**
   * Owner-gated: bind a provisioned wallet address to an agent.
   * Used at deploy/provision time (per-agent Altana wallet). Wallet is
   * immutable once set unless re-provisioned by the owner via lifecycle tooling.
   */
  async bindWallet(id: string, walletAddress: string, actorId: string): Promise<Agent | null> {
    const db = getAdminDb();
    const ref = agentRef(db, id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const existing = snap.data() as Agent;
    if (existing.ownerId !== actorId) {
      throw new BANError(ErrorCode.POLICY_DENIED, 'Not authorized to bind wallet for this agent', {
        correlationId: getCorrelationId(),
      });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      throw new BANError(ErrorCode.SCHEMA_INVALID, `Invalid wallet address: ${walletAddress}`, {
        correlationId: getCorrelationId(),
      });
    }
    await ref.update({ walletAddress, updatedAt: new Date().toISOString() });
    const updated = (await ref.get()).data() as Agent;
    logger.info('agent_wallet_bound', { agentId: id, actorId, walletAddress });
    return updated;
  }

  /**
   * Drive a lifecycle transition through the server-side state machine.
   * Validation order: authorization -> valid transition -> readiness.
   * Always emits an audit event. REVOKED is terminal.
   */
  async lifecycle(id: string, action: LifecycleAction, actorId: string): Promise<Agent> {
    const db = getAdminDb();
    const ref = agentRef(db, id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.VALIDATION_FAILED, 'Agent not found', {
        correlationId: getCorrelationId(),
      });
    }
    const agent = snap.data() as Agent;

    if (agent.ownerId !== actorId) {
      throw new BANError(ErrorCode.POLICY_DENIED, 'Not authorized to manage this agent', {
        correlationId: getCorrelationId(),
      });
    }

    assertTransitionAllowed(agent, action);
    if (action === 'activate') assertActivationReady(agent);

    const t = TRANSITIONS[action];
    const to = t.to;
    await ref.update({ status: to, updatedAt: new Date().toISOString() });

    await writeAgentAuditEvent({
      eventType: t.audit,
      agentId: id,
      correlationId: getCorrelationId(),
      actorId,
      from: agent.status,
      to,
    });

    logger.info('agent_lifecycle', { agentId: id, action, from: agent.status, to, actorId });
    return { ...agent, status: to, updatedAt: new Date().toISOString() };
  }
}

// Shared singleton so every route uses the same authoritative registry.
export const agentRegistry = new AgentRegistry();