import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

/**
 * BAN Firebase client SDK initializer.
 *
 * Reads NEXT_PUBLIC_ vars (required for browser-side usage in Next.js).
 * Initializes the default Firebase app and exports `auth` (for
 * signInWithEmailAndPassword / createUserWithEmailAndPassword / onAuthStateChanged
 * client-side) and `db` (for direct Firestore reads in the browser when needed).
 *
 * If env vars are absent (e.g. in tests or SSR without env), both `auth` and `db`
 * are null — consumer code must handle this gracefully.
 */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const hasConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = hasConfig && !getApps().length ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

export default app;