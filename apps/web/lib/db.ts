import 'server-only';

/**
 * BAN server-side data access for legacy account flows (developer / credits /
 * api keys / hirings / transactions).
 *
 * IMPORTANT: this layer uses the FIREBASE ADMIN SDK (`getAdminDb()`) rather
 * than the client SDK. The Admin SDK has full service-account privileges, so
 * it BYPASSES Firestore security rules — eliminating the `permission-denied`
 * failures the client SDK produced for these routes. This is the same strategy
 * the modern BAN control-plane (agent-registry) already uses.
 *
 * All exported function signatures are compatible with the existing API routes.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin';
import {
  Developer,
  Agent,
  Task,
  Hiring,
  CreditTransaction,
  ApiKey,
} from './schemas';

const USER_COLLECTION = 'users';

// ---------------------------------------------------------------------------
// Developers
// ---------------------------------------------------------------------------

export async function createDeveloper(
  id: string,
  data: Omit<Developer, 'id' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const db = getAdminDb();
  await db.collection(USER_COLLECTION).doc(id).set({
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

export async function getDeveloper(id: string): Promise<Developer | null> {
  const db = getAdminDb();
  const snap = await db.collection(USER_COLLECTION).doc(id).get();
  return snap.exists ? (snap.data() as unknown as Developer) : null;
}

export async function getDeveloperByEmail(email: string): Promise<Developer | null> {
  const db = getAdminDb();
  const snap = await db
    .collection(USER_COLLECTION)
    .where('email', '==', email)
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as unknown as Developer);
}

export async function updateDeveloper(id: string, data: Partial<Developer>): Promise<void> {
  const db = getAdminDb();
  await db.collection(USER_COLLECTION).doc(id).update({
    ...data,
    updatedAt: Timestamp.now(),
  });
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export async function createApiKey(data: Omit<ApiKey, 'id'>): Promise<string> {
  const db = getAdminDb();
  const ref = await db.collection('apiKeys').add({
    ...data,
    createdAt: Timestamp.now(),
    lastUsedAt: null,
    revokedAt: null,
  });
  return ref.id;
}

export async function getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
  const db = getAdminDb();
  const snap = await db
    .collection('apiKeys')
    .where('keyHash', '==', keyHash)
    .where('revokedAt', '==', null)
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as unknown as ApiKey);
}

export async function getDeveloperApiKeys(developerId: string): Promise<ApiKey[]> {
  const db = getAdminDb();
  const snap = await db
    .collection('apiKeys')
    .where('developerId', '==', developerId)
    .get();
  return snap.docs.map((doc) => doc.data() as unknown as ApiKey);
}

export async function revokeApiKey(id: string): Promise<void> {
  const db = getAdminDb();
  await db.collection('apiKeys').doc(id).update({ revokedAt: Timestamp.now() });
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function createAgent(data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const db = getAdminDb();
  const ref = await db.collection('agents').add({
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

export async function getAgent(id: string): Promise<Agent | null> {
  const db = getAdminDb();
  const snap = await db.collection('agents').doc(id).get();
  return snap.exists ? (snap.data() as unknown as Agent) : null;
}

export async function getDeveloperAgents(developerId: string): Promise<Agent[]> {
  const db = getAdminDb();
  const snap = await db
    .collection('agents')
    .where('developerId', '==', developerId)
    .where('isActive', '==', true)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as unknown as Agent);
}

export async function getAllAgents(): Promise<Agent[]> {
  const db = getAdminDb();
  const snap = await db
    .collection('agents')
    .where('isActive', '==', true)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as unknown as Agent);
}

export async function updateAgent(id: string, data: Partial<Agent>): Promise<void> {
  const db = getAdminDb();
  await db.collection('agents').doc(id).update({ ...data, updatedAt: Timestamp.now() });
}

export async function deleteAgent(id: string): Promise<void> {
  const db = getAdminDb();
  await db.collection('agents').doc(id).update({ isActive: false, updatedAt: Timestamp.now() });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(data: Omit<Task, 'id' | 'createdAt'>): Promise<string> {
  const db = getAdminDb();
  const ref = await db.collection('tasks').add({ ...data, createdAt: Timestamp.now() });
  return ref.id;
}

export async function getTask(id: string): Promise<Task | null> {
  const db = getAdminDb();
  const snap = await db.collection('tasks').doc(id).get();
  return snap.exists ? (snap.data() as unknown as Task) : null;
}

export async function updateTask(id: string, data: Partial<Task>): Promise<void> {
  const db = getAdminDb();
  await db.collection('tasks').doc(id).update({ ...data });
}

// ---------------------------------------------------------------------------
// Hirings
// ---------------------------------------------------------------------------

export async function createHiring(data: Omit<Hiring, 'id' | 'createdAt'>): Promise<string> {
  const db = getAdminDb();
  const ref = await db.collection('hirings').add({ ...data, createdAt: Timestamp.now() });
  return ref.id;
}

export async function getHiring(id: string): Promise<Hiring | null> {
  const db = getAdminDb();
  const snap = await db.collection('hirings').doc(id).get();
  return snap.exists ? (snap.data() as unknown as Hiring) : null;
}

export async function getDeveloperHirings(developerId: string, limitCount: number = 50): Promise<Hiring[]> {
  const db = getAdminDb();
  const snap = await db
    .collection('hirings')
    .where('developerId', '==', developerId)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map((doc) => doc.data() as unknown as Hiring);
}

export async function updateHiring(id: string, data: Partial<Hiring>): Promise<void> {
  const db = getAdminDb();
  await db.collection('hirings').doc(id).update({ ...data });
}

// ---------------------------------------------------------------------------
// Credit Transactions
// ---------------------------------------------------------------------------

export async function createCreditTransaction(data: Omit<CreditTransaction, 'id' | 'createdAt'>): Promise<string> {
  const db = getAdminDb();
  const ref = await db.collection('creditTransactions').add({ ...data, createdAt: Timestamp.now() });
  return ref.id;
}

export async function getDeveloperTransactions(developerId: string, limitCount: number = 100): Promise<CreditTransaction[]> {
  const db = getAdminDb();
  const snap = await db
    .collection('creditTransactions')
    .where('developerId', '==', developerId)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map((doc) => doc.data() as unknown as CreditTransaction);
}