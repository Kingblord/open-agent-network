import 'server-only';

/**
 * BAN server-side Firebase Admin bootstrap (control-plane / Firestore).
 * Server-only: never import this from a client component.
 *
 * Reads the non-NEXT_PUBLIC environment vars from .env.local:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
 *   FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL (optional)
 *
 * The Firebase app is initialized LAZILY (on first getAdminApp() call), not at
 * module-import time. This lets tests / tooling import this module even when
 * env vars are absent without throwing, and only errors when a real read/write
 * is attempted without credentials.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

/**
 * Normalizes FIREBASE_PRIVATE_KEY into a PEM string that firebase-admin's
 * cert() accepts. Supports three formats so Vercel env vars never fight us:
 *
 *   1. Plain PEM (multi-line)                    -> passed through
 *   2. PEM with escaped "\n" (single-line env)   -> \n unescaped
 *   3. Base64-encoded PEM (single-line env)      -> decoded, then \n unescaped
 *
 * If the value is neither PEM nor decodable base64, it is returned as-is
 * (fail-open on format, so the original error from cert() surfaces instead of
 * a confusing decode error).
 */
export function normalizePrivateKey(key: string): string {
  const trimmed = key.trim();

  const unescape = (pem: string) => pem.replace(/\\n/g, '\n');

  // 1) Already PEM (multi-line or escaped single-line) — just unescape.
  if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(trimmed)) {
    return unescape(trimmed);
  }

  // 2) Base64-encoded PEM (single-line) — decode and re-normalize.
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(decoded)) {
      return unescape(decoded);
    }
  } catch {
    // Not valid base64 — fall through to pass-through below.
  }

  // 3) Unknown format — pass through (existing behavior).
  return unescape(trimmed);
}

// Cache the singleton app reference across hot reloads / repeated calls.
let cachedApp: ReturnType<typeof initializeApp> | null = null;

/**
 * Returns the Admin SDK app instance (named 'ban-admin'), lazily initialized.
 * Reuses any existing default app if one exists.
 */
export function getAdminApp(): ReturnType<typeof initializeApp> {
  if (cachedApp) return cachedApp;
  const existing = getApps();
  const named = existing.find((a) => a.name === 'ban-admin');
  if (named) {
    cachedApp = named as ReturnType<typeof initializeApp>;
    return cachedApp;
  }
  cachedApp = initializeApp(
    {
      credential: cert({
        projectId: projectId!,
        clientEmail: clientEmail!,
        privateKey: normalizePrivateKey(privateKey!),
      }),
    },
    'ban-admin'
  );
  return cachedApp;
}

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(projectId && clientEmail && privateKey);
}

export function getAdminDb() {
  if (!isFirebaseAdminConfigured()) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local'
    );
  }
  return getFirestore(getAdminApp());
}

// Collection names used by the BAN control plane.
export const collections = {
  users: 'users',
  agents: 'agents',
  agentSessions: 'agent_sessions',
  agentPermissions: 'agent_permissions',
  strategies: 'strategies',
  actionProposals: 'action_proposals',
  executions: 'executions',
  jobs: 'jobs',
  spendLedger: 'spend_ledger',
  positions: 'positions',
  marketData: 'market_data',
  performance: 'performance',
  auditEvents: 'audit_events',
  agentEvents: 'agent_events',
  protocolConfigs: 'protocol_configs',
} as const;

// BAN control-plane user document fields.
export interface BanUser {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
}