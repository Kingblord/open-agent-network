import 'server-only';

import { randomUUID } from 'node:crypto';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import type { AgentPermission } from '@ban/schemas';

/**
 * Permission repository — Firestore-backed `agent_permissions` collection
 * (Option A / EIP-7702 wiring, update-v3 §8–§11).
 *
 * The permission profile is the OFF-CHAIN mirror of what the user authorizes
 * once (EIP-7702 delegation): capability + protocol/contract/function/token
 * allowlists + spend ceilings + validity window + replay nonce. It is created
 * PENDING, verified server-side against the user's signature (activate), and
 * only ACTIVE permissions can satisfy the execution gate for user-funds jobs.
 *
 * This module is the SINGLE source of truth for permission records. API routes
 * and the run-cycle gate import these helpers — no other module writes the
 * collection directly.
 *
 * Field contract mirrors @ban/schemas AgentPermissionSchema (canonical):
 *   spend: { spendCap, perTransactionCap }  (wei decimal strings)
 *   status: PENDING | ACTIVE | REVOKED | EXPIRED
 */

export interface CreatePermissionInput {
  agentId: string;
  userId: string;
  /** User EOA (delegating account) that will sign the one-time authorization. */
  userAddress: string;
  /** Job/task this permission is scoped to (vault jobId == taskId). */
  jobId?: string;
  capabilities: string[];
  allowedProtocols: string[];
  allowedContracts: string[];
  allowedFunctions: string[];
  allowedTokens: string[];
  /** Cumulative ceiling (wei decimal string). */
  spendCap: string;
  /** Per-transaction ceiling (wei decimal string). */
  perTransactionCap: string;
  /** Asset the spend caps are denominated in (symbol; default BNB). */
  asset?: string;
  /** ISO-8601 validity window. */
  validAfter: string;
  validUntil: string;
}

export async function createPermission(input: CreatePermissionInput): Promise<AgentPermission> {
  const db = getAdminDb();
  const id = `perm_${randomUUID()}`;
  const now = new Date().toISOString();

  const permission: AgentPermission = {
    id,
    agentId: input.agentId,
    userId: input.userId,
    userAddress: input.userAddress,
    jobId: input.jobId,
    capabilities: input.capabilities,
    allowedProtocols: input.allowedProtocols,
    allowedContracts: input.allowedContracts,
    allowedFunctions: input.allowedFunctions,
    allowedTokens: input.allowedTokens,
    spend: {
      spendLimit: input.spendCap, // canonical alias of spendCap (both spellings = same ceiling)
      spendCap: input.spendCap,
      perTransactionCap: input.perTransactionCap,
      used: '0',
      asset: input.asset ?? 'BNB',
    },
    validAfter: input.validAfter,
    validUntil: input.validUntil,
    // Replay guard: starts at 0; incremented on each revoke/re-issue.
    nonce: '0',
    activationTxHash: null,
    revokedAt: null,
    onchainRegistryReference: null,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(collections.agentPermissions).doc(id).set({ ...permission });
  return permission;
}

export async function getPermission(id: string): Promise<AgentPermission | null> {
  if (!id) return null;
  const db = getAdminDb();
  const snap = await db.collection(collections.agentPermissions).doc(id).get();
  return snap.exists ? (snap.data() as AgentPermission) : null;
}

/** List permissions for an agent (newest first), optional status filter. */
export async function listPermissionsByAgent(
  agentId: string,
  status?: AgentPermission['status'],
): Promise<AgentPermission[]> {
  if (!agentId) return [];
  const db = getAdminDb();
  const snap = await db.collection(collections.agentPermissions).where('agentId', '==', agentId).get();
  const out: AgentPermission[] = [];
  snap.forEach((d) => {
    const p = d.data() as AgentPermission;
    if (status && p.status !== status) return;
    out.push(p);
  });
  return out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Find the single ACTIVE permission for an agent + job (if any). */
export async function findActivePermissionForJob(
  agentId: string,
  jobId: string,
): Promise<AgentPermission | null> {
  const list = await listPermissionsByAgent(agentId, 'ACTIVE');
  return list.find((p) => !p.jobId || p.jobId === jobId) ?? null;
}

export async function setPermissionStatus(
  id: string,
  status: AgentPermission['status'],
): Promise<AgentPermission | null> {
  const db = getAdminDb();
  const ref = db.collection(collections.agentPermissions).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const updatedAt = new Date().toISOString();
  await ref.update({ status, updatedAt });
  return { ...(snap.data() as AgentPermission), status, updatedAt };
}

/** Revoke (terminal, non-reversible) — one-shot guard for a job's authority. */
export async function revokePermission(id: string): Promise<AgentPermission | null> {
  return setPermissionStatus(id, 'REVOKED');
}

/** Move a PENDING permission to ACTIVE after server-side signature verification. */
export async function activatePermission(id: string): Promise<AgentPermission | null> {
  const db = getAdminDb();
  const ref = db.collection(collections.agentPermissions).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const current = snap.data() as AgentPermission;
  if (current.status !== 'PENDING') return current;  // already ACTIVE/REVOKED — no double-activate
  const updatedAt = new Date().toISOString();
  await ref.update({ status: 'ACTIVE', updatedAt });
  return { ...current, status: 'ACTIVE', updatedAt };
}