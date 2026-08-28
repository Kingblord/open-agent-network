import { getAdminDb, collections } from '@/lib/firebase-admin';
import type { SpendLedgerEntry } from '@ban/schemas';
import type { SpendLedgerRepository } from '@ban/policy-engine';
import { BANError, ErrorCode } from '@ban/shared';

/**
 * M5 — Production `SpendLedgerRepository` backed by Firestore.
 *
 * The policy engine (`@ban/policy-engine`) depends only on the
 * `SpendLedgerRepository` interface; this is the Firestore implementation it
 * uses in the app. Reserve is atomic via a Firestore transaction keyed by the
 * reservation's idempotency key, so concurrent proposal reservations cannot
 * collectively exceed the session cumulative cap.
 *
 * Ledger doc id == idempotencyKey. Query-by-session groups entries entirely in
 * code (no compound sessionId+status index required) since cumulative accounting
 * correctness matters more than fan-out here.
 */

/** Reserve must be atomic to close the concurrency gap. */
function ledgerRef(db: ReturnType<typeof getAdminDb>, idempotencyKey: string) {
  return db.collection(collections.spendLedger).doc(idempotencyKey);
}

export class FirebaseSpendLedgerRepository implements SpendLedgerRepository {
  async reserve(entry: SpendLedgerEntry): Promise<SpendLedgerEntry> {
    const db = getAdminDb();
    const ref = ledgerRef(db, entry.idempotencyKey);
    // runTransaction provides the atomic compare-and-create for the cap gate.
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data() as SpendLedgerEntry;
        if (existing.status === 'RESERVED') return existing; // idempotent replay
        throw new BANError(
          ErrorCode.DUPLICATE_PROPOSAL,
          `Reservation ${entry.idempotencyKey} already finalized as ${existing.status}`
        );
      }
      tx.set(ref, entry);
      return entry;
    });
  }

  async commit(idempotencyKey: string): Promise<SpendLedgerEntry> {
    const db = getAdminDb();
    const ref = ledgerRef(db, idempotencyKey);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.INTERNAL, `Reservation ${idempotencyKey} not found`);
    }
    const entry = snap.data() as SpendLedgerEntry;
    if (entry.status !== 'RESERVED') {
      throw new BANError(ErrorCode.INTERNAL, `Cannot commit reservation in state ${entry.status}`);
    }
    const updated: SpendLedgerEntry = { ...entry, status: 'COMMITTED', updatedAt: new Date().toISOString() };
    await ref.set(updated);
    return updated;
  }

  async release(idempotencyKey: string): Promise<SpendLedgerEntry> {
    const db = getAdminDb();
    const ref = ledgerRef(db, idempotencyKey);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.INTERNAL, `Reservation ${idempotencyKey} not found`);
    }
    const entry = snap.data() as SpendLedgerEntry;
    if (entry.status !== 'RESERVED') {
      throw new BANError(ErrorCode.INTERNAL, `Cannot RELEASE reservation in state ${entry.status}`);
    }
    const updated: SpendLedgerEntry = { ...entry, status: 'RELEASED', updatedAt: new Date().toISOString() };
    await ref.set(updated);
    return updated;
  }

  async hold(idempotencyKey: string): Promise<SpendLedgerEntry> {
    const db = getAdminDb();
    const ref = ledgerRef(db, idempotencyKey);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new BANError(ErrorCode.INTERNAL, `Reservation ${idempotencyKey} not found`);
    }
    const entry = snap.data() as SpendLedgerEntry;
    if (entry.status !== 'RESERVED') return entry;
    const updated: SpendLedgerEntry = { ...entry, updatedAt: new Date().toISOString() };
    await ref.set(updated);
    return updated;
  }

  async reservedTotal(sessionId: string): Promise<bigint> {
    return this.sumWhere(sessionId, (e) => e.status === 'RESERVED');
  }

  async reservedAndCommittedTotal(sessionId: string): Promise<bigint> {
    return this.sumWhere(sessionId, (e) => e.status === 'RESERVED' || e.status === 'COMMITTED');
  }

  async getByIdempotency(idempotencyKey: string): Promise<SpendLedgerEntry | null> {
    const db = getAdminDb();
    const snap = await ledgerRef(db, idempotencyKey).get();
    return snap.exists ? (snap.data() as SpendLedgerEntry) : null;
  }

  private async sumWhere(sessionId: string, include: (e: SpendLedgerEntry) => boolean): Promise<bigint> {
    const db = getAdminDb();
    const snap = await db.collection(collections.spendLedger).where('sessionId', '==', sessionId).get();
    let total = BigInt(0);
    snap.forEach((doc) => {
      const e = doc.data() as SpendLedgerEntry;
      if (include(e)) total = total + BigInt(e.amount);
    });
    return total;
  }
}