import 'server-only';

import { access, mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { getAdminDb, isFirebaseAdminConfigured, collections } from '@/lib/firebase-admin';
import { createStructuredLogger } from '@/lib/core/logger';

/**
 * Per-agent Altana keystore (mustflow §27–28 — one agent, one dedicated
 * wallet/address, one private-key signer).
 *
 * Each deployed agent owns its OWN wallet. Its signing key is generated at
 * deploy/provision time and stored ENCRYPTED (AES-256-GCM) in Firestore under
 * `agent_keystores/<agentId>`, so the key survives cold starts, redeploys and
 * per-instance ephemeral /tmp on serverless (Vercel/Lambda). A local
 * filesystem mirror (mode 0600) is kept as best-effort for local dev and
 * same-instance fast reads. The private key is NEVER stored in plaintext and
 * NEVER returned by any API — only the derived `walletAddress` is exposed.
 *
 * Provably serverless-safe storage flow:
 *   1. Firestore REQUIRES the encryption key (`BAN_KEYSTORE_ENCRYPTION_KEY`).
 *      If Firestore is configured but the key is missing, provisioning fails
 *      loudly rather than silently writing plaintext.
 *   2. Without Firestore env (local dev / hermetic tests) we fall back to the
 *      legacy filesystem path exactly as before — behavior unchanged.
 *   3. The local file mirror is best-effort: on serverless the bundle dir is
 *      read-only, so mirror failures are logged and ignored; the Firestore
 *      copy is authoritative.
 *
 * Keyless Altana model (no relayer, no Altana API key):
 *   - SDK + signer key + funded BNB wallet is the whole stack.
 *   - The first execute() activates the wallet and registers its admin key in
 *     Altana's KeyStore — the wallet must be funded with BNB before that.
 *
 * `BAN_BNB_PRIVATE_KEY` (env) remains only an operator bootstrap/fallback for
 * the legacy single-key path. Once an agent keystore exists it takes precedence
 * for that agent.
 */

export interface AgentKeystore {
  agentId: string;
  privateKey: `0x${string}`;
  walletAddress: string;
  createdAt: string;
}

/** The Firestore document shape — encrypted payload, never a plaintext key. */
export interface EncryptedKeystoreDoc {
  agentId: string;
  walletAddress: string;
  /** AES-256-GCM ciphertext (hex) of the serialized AgentKeystore. */
  encryptedKey: string;
  /** 96-bit random IV (hex). */
  iv: string;
  /** GCM auth tag (hex) — tamper detection. */
  authTag: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
}

const logger = createStructuredLogger('keystore');

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function getAltanaStoreDir(): string {
  const raw = process.env.ALTANA_SDK_STORE_DIR;
  const serverless = isServerlessRuntime();

  if (raw) {
    // On serverless only trust an explicit ABSOLUTE path; a relative value
    // resolves against /var/task (read-only) and breaks mkdir.
    if (!serverless) return path.resolve(raw);
    if (path.isAbsolute(raw)) return raw;
  }

  if (serverless) {
    // os.tmpdir() is /tmp on Lambda/Vercel functions — the only writable
    // location for the local mirror.
    return path.join(os.tmpdir(), 'ban-altana');
  }

  return path.resolve(process.cwd(), '.altana');
}

export function agentKeystorePath(agentId: string): string {
  return path.join(getAltanaStoreDir(), agentId, 'key.json');
}

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------

/**
 * The 32-byte AES key derived from `BAN_KEYSTORE_ENCRYPTION_KEY`.
 * Accepts a 64-char hex string directly; any other value is SHA-256-derived
 * so a stray whitespace/format never silently produces a different key.
 * Returns null when the env var is unset (persistent path disabled).
 */
function keystoreEncryptionKey(): Buffer | null {
  const raw = process.env.BAN_KEYSTORE_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return createHash('sha256').update(trimmed).digest();
}

/**
 * Persistent storage is usable only when BOTH Firestore admin env vars AND the
 * encryption key are configured. If Firestore is configured but the key is
 * missing we must NOT write plaintext — callers fail loudly instead.
 */
function persistentKeystoreAvailable(): boolean {
  return isFirebaseAdminConfigured() && keystoreEncryptionKey() !== null;
}

function encryptKeystore(keystore: AgentKeystore, key: Buffer): EncryptedKeystoreDoc {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(keystore), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const now = new Date().toISOString();
  return {
    agentId: keystore.agentId,
    walletAddress: keystore.walletAddress,
    encryptedKey: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    version: 1,
    createdAt: keystore.createdAt,
    updatedAt: now,
  };
}

/** Decrypt + validate an encrypted doc. Returns null on any integrity failure. */
function decryptKeystore(doc: EncryptedKeystoreDoc, key: Buffer): AgentKeystore | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(doc.authTag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(doc.encryptedKey, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plain) as AgentKeystore;
    if (!parsed || parsed.agentId !== doc.agentId || !parsed.privateKey || !parsed.walletAddress) {
      return null;
    }
    return parsed;
  } catch (err) {
    logger.error('keystore_decrypt_failed', { agentId: doc.agentId }, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Keystore operations (Firestore-first, FS mirror)
// ---------------------------------------------------------------------------

export async function hasAgentKeystore(agentId: string): Promise<boolean> {
  if (persistentKeystoreAvailable()) {
    try {
      const db = getAdminDb();
      const snap = await db.collection(collections.agentKeystores).doc(agentId).get();
      if (snap.exists) return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('keystore_firestore_read_failed', { agentId, message });
      // Fall through to the local mirror.
    }
  }
  try {
    await access(agentKeystorePath(agentId), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadAgentKeystore(agentId: string): Promise<AgentKeystore | null> {
  // 1) Authoritative: encrypted Firestore copy (survives cold starts / redeploys).
  if (persistentKeystoreAvailable()) {
    try {
      const db = getAdminDb();
      const snap = await db.collection(collections.agentKeystores).doc(agentId).get();
      if (snap.exists) {
        const doc = snap.data() as EncryptedKeystoreDoc;
        const key = keystoreEncryptionKey()!;
        const keystore = decryptKeystore(doc, key);
        if (keystore) return keystore;
        logger.error('keystore_firestore_corrupt', { agentId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('keystore_firestore_read_failed', { agentId, message });
      // Fall through to the local mirror.
    }
  }

  // 2) Local filesystem mirror (dev / sandbox / same-instance fast path).
  try {
    const raw = await readFile(agentKeystorePath(agentId), 'utf8');
    const parsed = JSON.parse(raw) as AgentKeystore;
    if (!parsed || parsed.agentId !== agentId || !parsed.privateKey || !parsed.walletAddress) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAgentKeystore(keystore: AgentKeystore): Promise<void> {
  const file = agentKeystorePath(keystore.agentId);

  // 1) Authoritative: encrypted Firestore copy. Fail loudly if the durable
  //    store cannot be written (never silently degrade to ephemeral /tmp).
  if (persistentKeystoreAvailable()) {
    try {
      const db = getAdminDb();
      const doc = encryptKeystore(keystore, keystoreEncryptionKey()!);
      await db.collection(collections.agentKeystores).doc(keystore.agentId).set(doc);
      logger.info('keystore_saved_firestore', { agentId: keystore.agentId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('keystore_firestore_save_failed', { agentId: keystore.agentId, message });
      throw err;
    }
  } else if (isFirebaseAdminConfigured()) {
    // Firestore configured but the encryption key is missing — refuse to
    // persist plaintext anywhere durable. This surfaces as provision_failed
    // with a clear cause instead of an insecure fallback.
    throw new Error(
      'BAN_KEYSTORE_ENCRYPTION_KEY is not set but Firestore is configured. ' +
        'Set it (openssl rand -hex 32) before provisioning agent keystores.'
    );
  }

  // 2) Local mirror (best-effort; helps local dev + same-instance reads).
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(keystore, null, 2), { mode: 0o600 });
  } catch (err) {
    // On serverless the bundle dir is read-only; mirror is best-effort only.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('keystore_fs_mirror_failed', { agentId: keystore.agentId, message });
  }
}

/**
 * Permanently destroy an agent's keystore (Firestore + local mirror).
 *
 * Used by the profile "MANAGE AGENTS" delete flow: after terminal-revoking the
 * agent, its dedicated signing key is destroyed so nothing can sign for it
 * anymore. Idempotent — deleting a missing keystore is a no-op success.
 * The on-chain wallet address itself is immutable, but without the key no
 * further transactions can originate from BAN for this agent.
 */
export async function deleteAgentKeystore(agentId: string): Promise<void> {
  // 1) Firestore authoritative copy.
  if (persistentKeystoreAvailable()) {
    try {
      const db = getAdminDb();
      await db.collection(collections.agentKeystores).doc(agentId).delete();
      logger.info('keystore_deleted_firestore', { agentId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('keystore_firestore_delete_failed', { agentId, message });
      throw err;
    }
  }

  // 2) Local mirror (best-effort).
  try {
    await rm(agentKeystorePath(agentId), { recursive: true, force: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('keystore_fs_delete_failed', { agentId, message });
  }
}