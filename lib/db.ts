import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  addDoc,
  Timestamp,
  Query,
  DocumentData,
  orderBy,
  limit,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  Developer,
  Agent,
  Task,
  Hiring,
  CreditTransaction,
  ApiKey,
} from './schemas';

// Developers Collection
export async function createDeveloper(
  id: string,
  data: Omit<Developer, 'id' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  await setDoc(doc(db, 'developers', id), {
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

export async function getDeveloper(id: string): Promise<Developer | null> {
  const snap = await getDoc(doc(db, 'developers', id));
  return snap.exists() ? (snap.data() as Developer) : null;
}

export async function getDeveloperByEmail(email: string): Promise<Developer | null> {
  const q = query(collection(db, 'developers'), where('email', '==', email));
  const snap = await getDocs(q);
  return snap.empty ? null : (snap.docs[0].data() as Developer);
}

export async function updateDeveloper(id: string, data: Partial<Developer>): Promise<void> {
  await updateDoc(doc(db, 'developers', id), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

// API Keys Collection
export async function createApiKey(
  data: Omit<ApiKey, 'id'>
): Promise<string> {
  const docRef = await addDoc(collection(db, 'apiKeys'), {
    ...data,
    createdAt: Timestamp.now(),
    lastUsedAt: null,
    revokedAt: null,
  });
  return docRef.id;
}

export async function getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
  const q = query(
    collection(db, 'apiKeys'),
    where('keyHash', '==', keyHash),
    where('revokedAt', '==', null)
  );
  const snap = await getDocs(q);
  return snap.empty ? null : (snap.docs[0].data() as ApiKey);
}

export async function getDeveloperApiKeys(developerId: string): Promise<ApiKey[]> {
  const q = query(
    collection(db, 'apiKeys'),
    where('developerId', '==', developerId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data() as ApiKey);
}

export async function revokeApiKey(id: string): Promise<void> {
  await updateDoc(doc(db, 'apiKeys', id), {
    revokedAt: Timestamp.now(),
  });
}

// Agents Collection
export async function createAgent(
  data: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const docRef = await addDoc(collection(db, 'agents'), {
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getAgent(id: string): Promise<Agent | null> {
  const snap = await getDoc(doc(db, 'agents', id));
  return snap.exists() ? (snap.data() as Agent) : null;
}

export async function getDeveloperAgents(developerId: string): Promise<Agent[]> {
  const q = query(
    collection(db, 'agents'),
    where('developerId', '==', developerId),
    where('isActive', '==', true)
  );
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agent));
}

export async function getAllAgents(
  constraints: QueryConstraint[] = []
): Promise<Agent[]> {
  const baseQuery = query(
    collection(db, 'agents'),
    where('isActive', '==', true),
    ...constraints
  );
  const snap = await getDocs(baseQuery);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agent));
}

export async function updateAgent(id: string, data: Partial<Agent>): Promise<void> {
  await updateDoc(doc(db, 'agents', id), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await updateDoc(doc(db, 'agents', id), {
    isActive: false,
    updatedAt: Timestamp.now(),
  });
}

// Tasks Collection
export async function createTask(
  data: Omit<Task, 'id' | 'createdAt'>
): Promise<string> {
  const docRef = await addDoc(collection(db, 'tasks'), {
    ...data,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getTask(id: string): Promise<Task | null> {
  const snap = await getDoc(doc(db, 'tasks', id));
  return snap.exists() ? (snap.data() as Task) : null;
}

export async function updateTask(id: string, data: Partial<Task>): Promise<void> {
  await updateDoc(doc(db, 'tasks', id), {
    ...data,
  });
}

// Hirings Collection
export async function createHiring(
  data: Omit<Hiring, 'id' | 'createdAt'>
): Promise<string> {
  const docRef = await addDoc(collection(db, 'hirings'), {
    ...data,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getHiring(id: string): Promise<Hiring | null> {
  const snap = await getDoc(doc(db, 'hirings', id));
  return snap.exists() ? (snap.data() as Hiring) : null;
}

export async function getDeveloperHirings(
  developerId: string,
  limitCount: number = 50
): Promise<Hiring[]> {
  const q = query(
    collection(db, 'hirings'),
    where('developerId', '==', developerId),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data() as Hiring);
}

export async function updateHiring(id: string, data: Partial<Hiring>): Promise<void> {
  await updateDoc(doc(db, 'hirings', id), {
    ...data,
  });
}

// Credit Transactions Collection
export async function createCreditTransaction(
  data: Omit<CreditTransaction, 'id' | 'createdAt'>
): Promise<string> {
  const docRef = await addDoc(collection(db, 'creditTransactions'), {
    ...data,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getDeveloperTransactions(
  developerId: string,
  limitCount: number = 100
): Promise<CreditTransaction[]> {
  const q = query(
    collection(db, 'creditTransactions'),
    where('developerId', '==', developerId),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data() as CreditTransaction);
}
