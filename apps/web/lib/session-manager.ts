import 'server-only';

import { getAdminDb, collections } from '@/lib/firebase-admin';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { generateId, BANError, ErrorCode } from '@ban/shared';
import { SessionSchema, type Session, type SessionStatus } from '@ban/schemas';
import type { AltanaAdapter, SessionCallRequest } from '@/lib/altana/adapter';

const logger = createStructuredLogger('sessions.manager');

/**
 * M4 - BAN SessionManager.
 *
 * Durable, SDK-agnostic ownership of the `agent_sessions` lifecycle. It talks
 * to the Altana wallet/session stack ONLY through the `AltanaAdapter` seam, so
 * the state machine, limits, expiry and deny-unauthorized logic are provable
 * in hermetic tests (via the DEV adapter) without any real chain / passkey
 * runtime.
 */

function sessionRef(db: ReturnType<typeof getAdminDb>, sessionId: string) {
  return db.collection(collections.agentSessions).doc(sessionId);
}

export interface GrantSessionInput {
  agentId: string;
  walletAddress: string;
  allowedContracts: string[];
  allowedFunctions: string[];
  allowedTokens: string[];
  /** wei as decimal string */
  spendCap: string;
  /** wei as decimal string, must be <= spendCap */
  perTransactionCap: string;
  /** ms since epoch */
  expiresAtMs: number;
}

export interface UpdateSessionConfigInput {
  allowedContracts?: string[];
  allowedFunctions?: string[];
  allowedTokens?: string[];
  /** wei as decimal string */
  spendCap?: string;
  /** wei as decimal string, must be <= spendCap */
  perTransactionCap?: string;
  /** ms since epoch */
  expiresAtMs?: number;
  riskLevel?: string;
}

export type SessionDecision = 'ALLOW' | 'DENY';

export interface SessionDecisionResult {
  decision: SessionDecision;
  failedCheck?: string;
  reason?: string;
}

export class SessionManager {
  constructor(private readonly adapter: AltanaAdapter) {}

  async create(input: GrantSessionInput): Promise<Session> {
    const now = Date.now();
    const perTx = BigInt(input.perTransactionCap || '0');
    const spend = BigInt(input.spendCap || '0');
    if (perTx > spend) {
      throw new BANError(ErrorCode.SPEND_LIMIT_EXCEEDED, 'perTransactionCap must not exceed spendCap', {
        correlationId: getCorrelationId(),
      });
    }
    if (input.expiresAtMs <= now) {
      throw new BANError(ErrorCode.SESSION_EXPIRED, 'expiresAt must be in the future', {
        correlationId: getCorrelationId(),
      });
    }

    const parsed = SessionSchema.safeParse({
      sessionId: '', // filled below
      agentId: input.agentId,
      walletAddress: input.walletAddress,
      sessionKeyReference: '', // filled on registration
      allowedContracts: input.allowedContracts,
      allowedFunctions: input.allowedFunctions,
      allowedTokens: input.allowedTokens,
      spendCap: input.spendCap,
      perTransactionCap: input.perTransactionCap,
      expiresAt: new Date(input.expiresAtMs).toISOString(),
      status: 'PENDING',
      onchainRegistryReference: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
    if (!parsed.success) {
      throw new BANError(ErrorCode.SCHEMA_INVALID, 'Invalid session payload: ' + parsed.error.message, {
        correlationId: getCorrelationId(),
      });
    }
    const sessionId = generateId('sess');
    const session: Session = { ...parsed.data, sessionId };

    const db = getAdminDb();
    await sessionRef(db, sessionId).set(session);
    logger.info('session_created', { sessionId, agentId: input.agentId, correlationId: getCorrelationId() });
    return session;
  }

  async registerSession(sessionId: string): Promise<Session> {
    const db = getAdminDb();
    const ref = sessionRef(db, sessionId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.VALIDATION_FAILED, 'Session not found', { correlationId: getCorrelationId() });
    }
    const session = snap.data() as Session;
    if (session.status !== 'PENDING') {
      throw new BANError(
        ErrorCode.VALIDATION_FAILED,
        `Cannot register session in state ${session.status} (must be PENDING)`,
        { correlationId: getCorrelationId() }
      );
    }
    if (this.isExpired(session)) {
      await ref.update({ status: 'EXPIRED', updatedAt: new Date().toISOString() });
      throw new BANError(ErrorCode.SESSION_EXPIRED, 'Session already expired before registration', {
        correlationId: getCorrelationId(),
      });
    }

    const granted = await this.adapter.grantSession({
      agentId: session.agentId,
      walletAddress: session.walletAddress,
      allowedContracts: session.allowedContracts,
      allowedFunctions: session.allowedFunctions,
      allowedTokens: session.allowedTokens,
      spendCap: session.spendCap,
      perTransactionCap: session.perTransactionCap,
      expiresAtUnixSec: Math.floor(new Date(session.expiresAt).getTime() / 1000),
    });

    const now = new Date().toISOString();
    const update = {
      status: 'ACTIVE' as const,
      sessionKeyReference: granted.sessionKeyReference,
      onchainRegistryReference: granted.onchainRegistryReference,
      updatedAt: now,
    };
    await ref.update(update);
    logger.info('session_registered', { sessionId, agentId: session.agentId, correlationId: getCorrelationId() });
    return { ...session, ...update };
  }

  /**
   * EDIT SESSION: apply config changes to an existing session.
   *
   * - Re-validates perTransactionCap <= spendCap and expiresAtMs in the future.
   * - Persists the patch through the same Firestore session record.
   * - If the session is ACTIVE, re-registers it through the Altana adapter so
   *   the bounded authority updates live (revoke+grant with the new config).
   * - PENDING sessions just get the stored config updated (registration will
   *   use the new values).
   */
  async updateSessionConfig(sessionId: string, patch: UpdateSessionConfigInput): Promise<Session> {
    const db = getAdminDb();
    const ref = sessionRef(db, sessionId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.VALIDATION_FAILED, 'Session not found', { correlationId: getCorrelationId() });
    }
    const existing = snap.data() as Session;

    const next: Session = {
      ...existing,
      allowedContracts: patch.allowedContracts ?? existing.allowedContracts,
      allowedFunctions: patch.allowedFunctions ?? existing.allowedFunctions,
      allowedTokens: patch.allowedTokens ?? existing.allowedTokens,
      spendCap: patch.spendCap ?? existing.spendCap,
      perTransactionCap: patch.perTransactionCap ?? existing.perTransactionCap,
      expiresAt: patch.expiresAtMs
        ? new Date(patch.expiresAtMs).toISOString()
        : existing.expiresAt,
      updatedAt: new Date().toISOString(),
    };

    const perTx = BigInt(next.perTransactionCap || '0');
    const spend = BigInt(next.spendCap || '0');
    if (perTx > spend) {
      throw new BANError(ErrorCode.SPEND_LIMIT_EXCEEDED, 'perTransactionCap must not exceed spendCap', {
        correlationId: getCorrelationId(),
      });
    }
    if (new Date(next.expiresAt).getTime() <= Date.now()) {
      throw new BANError(ErrorCode.SESSION_EXPIRED, 'expiresAt must be in the future', {
        correlationId: getCorrelationId(),
      });
    }

    // Persist the config patch (and optional informational riskLevel).
    const updateDoc: Record<string, unknown> = {
      allowedContracts: next.allowedContracts,
      allowedFunctions: next.allowedFunctions,
      allowedTokens: next.allowedTokens,
      spendCap: next.spendCap,
      perTransactionCap: next.perTransactionCap,
      expiresAt: next.expiresAt,
      updatedAt: next.updatedAt,
    };
    if (patch.riskLevel !== undefined) updateDoc.riskLevel = patch.riskLevel;
    await ref.update(updateDoc);

    // If ACTIVE, re-register so the live bounded authority actually changes
    // (Altana revoke + grant with the new config).
    if (next.status === 'ACTIVE') {
      try {
        if (next.sessionKeyReference) {
          await this.adapter.revokeSession({
            walletAddress: next.walletAddress,
            sessionKeyReference: next.sessionKeyReference,
          });
        }
        const granted = await this.adapter.grantSession({
          agentId: next.agentId,
          walletAddress: next.walletAddress,
          allowedContracts: next.allowedContracts,
          allowedFunctions: next.allowedFunctions,
          allowedTokens: next.allowedTokens,
          spendCap: next.spendCap,
          perTransactionCap: next.perTransactionCap,
          expiresAtUnixSec: Math.floor(new Date(next.expiresAt).getTime() / 1000),
        });
        const now = new Date().toISOString();
        await ref.update({
          sessionKeyReference: granted.sessionKeyReference,
          onchainRegistryReference: granted.onchainRegistryReference,
          updatedAt: now,
        });
        next.sessionKeyReference = granted.sessionKeyReference;
        next.onchainRegistryReference = granted.onchainRegistryReference;
        next.updatedAt = now;
      } catch (regErr) {
        logger.warn('session_re-register_failed', {
          sessionId,
          correlationId: getCorrelationId(),
          err: regErr instanceof Error ? regErr.message : String(regErr),
        });
        // Config is persisted; re-registration failure is surfaced to the UI
        // but does not roll back the session (it remains ACTIVE with pending
        // on-chain update until the next registration).
      }
    }

    logger.info('session_config_updated', { sessionId, status: next.status, correlationId: getCorrelationId() });
    return next;
  }

  async revokeSession(sessionId: string): Promise<Session> {
    const db = getAdminDb();
    const ref = sessionRef(db, sessionId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.VALIDATION_FAILED, 'Session not found', { correlationId: getCorrelationId() });
    }
    const session = snap.data() as Session;
    if (session.status !== 'PENDING' && session.status !== 'ACTIVE') {
      throw new BANError(ErrorCode.SESSION_REVOKED, `Cannot revoke session in state ${session.status}`, {
        correlationId: getCorrelationId(),
      });
    }
    let onchainRegistryReference: string | null = session.onchainRegistryReference;
    if (session.status === 'ACTIVE' && session.sessionKeyReference) {
      const result = await this.adapter.revokeSession({
        walletAddress: session.walletAddress,
        sessionKeyReference: session.sessionKeyReference,
      });
      onchainRegistryReference = result.onchainRegistryReference ?? onchainRegistryReference;
    }
    const now = new Date().toISOString();
    const update = {
      status: 'REVOKED' as const,
      onchainRegistryReference,
      updatedAt: now,
    };
    await ref.update(update);
    logger.info('session_revoked', { sessionId, agentId: session.agentId, correlationId: getCorrelationId() });
    return { ...session, ...update };
  }

  async requireActiveSession(sessionId: string): Promise<Session> {
    const db = getAdminDb();
    const snap = await sessionRef(db, sessionId).get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.VALIDATION_FAILED, 'Session not found', { correlationId: getCorrelationId() });
    }
    const session = snap.data() as Session;
    if (session.status !== 'ACTIVE') {
      throw new BANError(ErrorCode.VALIDATION_FAILED, `Session is not ACTIVE (${session.status})`, {
        correlationId: getCorrelationId(),
      });
    }
    if (this.isExpired(session)) {
      await this.update(sessionId, { status: 'EXPIRED' });
      throw new BANError(ErrorCode.SESSION_EXPIRED, 'Session has expired', { correlationId: getCorrelationId() });
    }
    return session;
  }

  authorize(session: Session, call: SessionCallRequest): SessionDecisionResult {
    if (session.status !== 'ACTIVE') {
      return deny('session_not_active', `Session status is ${session.status}`);
    }
    if (this.isExpired(session)) {
      return deny('session_expired', 'Session has expired');
    }
    const contractAllowed =
      session.allowedContracts.length === 0 ||
      session.allowedContracts.some((c) => c.toLowerCase() === call.to.toLowerCase());
    if (!contractAllowed) {
      return deny('contract_denied', `Contract ${call.to} is not allowed`);
    }
    if (session.allowedFunctions.length > 0 && call.function) {
      const fnAllowed = session.allowedFunctions.some((f) => f.toLowerCase() === (call.function ?? '').toLowerCase());
      if (!fnAllowed) {
        return deny('function_denied', `Function ${call.function} is not allowed`);
      }
    }
    if (session.allowedTokens.length > 0) {
      const tokenAllowed = session.allowedTokens.some((t) => t.toLowerCase() === call.token.toLowerCase());
      if (!tokenAllowed) {
        return deny('token_denied', `Token ${call.token} is not allowed`);
      }
    }
    if (call.amountWei && session.perTransactionCap) {
      if (BigInt(call.amountWei) > BigInt(session.perTransactionCap)) {
        return deny('per_transaction_cap_exceeded', 'Amount exceeds per-transaction cap');
      }
    }
    return { decision: 'ALLOW' };
  }

  async update(sessionId: string, patch: Partial<Session>): Promise<Session> {
    const db = getAdminDb();
    const ref = sessionRef(db, sessionId);
    await ref.update(patch);
    const snap = await ref.get();
    return snap.data() as Session;
  }

  async getById(sessionId: string): Promise<Session | null> {
    const db = getAdminDb();
    const snap = await sessionRef(db, sessionId).get();
    return snap.exists ? (snap.data() as Session) : null;
  }

  async listByAgent(agentId: string): Promise<Session[]> {
    const db = getAdminDb();
    // NOTE: deliberately no `.orderBy('updatedAt','desc')` in the Firestore
    // query — combining `where agentId ==` with an orderBy on another field
    // requires a manually-deployed composite index (the FAILED_PRECONDITION
    // / 500 the sessions list was hitting). Instead filter by equality only
    // and sort + cap in memory (same pattern as agent-registry.list and the
    // performance route). Returns the same result with no console dependency.
    const snap = await db
      .collection(collections.agentSessions)
      .where('agentId', '==', agentId)
      .limit(100)
      .get();
    const items: Session[] = [];
    snap.forEach((doc) => items.push(doc.data() as Session));
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return items;
  }

  private isExpired(session: Session): boolean {
    return new Date(session.expiresAt).getTime() <= Date.now();
  }
}

function deny(failedCheck: string, reason: string): SessionDecisionResult {
  return { decision: 'DENY', failedCheck, reason };
}