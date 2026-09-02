import 'server-only';

import { getAdminDb, collections } from '@/lib/firebase-admin';

/**
 * BAN Agent Runtime — load the latest task config for an agent.
 *
 * The Inngest tick loop (ban/agent.tick-loop + ban-agent-tick cron) and the
 * immediate run in POST /api/agents/:id/tasks need the *user-configured*
 * strategy params (grid bounds, caps, allowed protocols) so the strategy
 * actually trades the range the user set instead of hermetic defaults.
 *
 * Reads the newest `agent_tasks` row for the agent (the durable, user-visible
 * unit of work) and returns its `config` object verbatim. Returns `undefined`
 * when the agent has no tasks yet — callers fuse that with their own defaults
 * (fail-closed: absent config never fabricates bounds).
 *
 * Firestore index safety: single-field equality query only (`agentId`), then
 * newest-first in memory — no composite index required on the console.
 */
export interface TaskConfigRecord {
  network?: string;
  chainId?: number;
  maxTxUsd?: string;
  dailyLimitUsd?: string;
  maxTxWei?: string;
  dailyWei?: string;
  allowedTokens?: string[];
  allowedProtocols?: string[];
  allowedFunctions?: string[];
  riskLevel?: string;
  expiresAtMs?: number;
  // Grid strategy bounds (USD dollars as entered in the task modal).
  gridLowerPriceUsd?: number;
  gridUpperPriceUsd?: number;
  gridCount?: number;
  gridCapitalUsd?: number;
  gridMaxOrderUsd?: number;
}

export async function loadLatestTaskConfig(agentId: string): Promise<Record<string, unknown> | undefined> {
  if (!agentId) return undefined;
  const db = getAdminDb();
  // Avoid composite index: single-field equality + in-memory newest first.
  const snap = await db
    .collection(collections.agentTasks ?? 'agent_tasks')
    .where('agentId', '==', agentId)
    .get();

  let latestConfig: unknown;
  let latestAt = '';
  // for...of (not forEach) so TS keeps control-flow narrowing on `latestConfig`.
  for (const doc of snap.docs) {
    const row = doc.data() as { config?: unknown; createdAt?: string };
    const at = typeof row.createdAt === 'string' ? row.createdAt : '';
    if (at >= latestAt) {
      latestAt = at;
      latestConfig = row.config;
    }
  }
  if (!latestConfig || typeof latestConfig !== 'object') return undefined;
  return latestConfig as Record<string, unknown>;
}