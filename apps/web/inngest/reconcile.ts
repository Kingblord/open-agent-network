import 'server-only';

import { inngest } from './client';
import { createStructuredLogger } from '@/lib/core/logger';
import { getAdminDb, collections } from '@/lib/firebase-admin';
import { agentRegistry } from '@/lib/agent-registry';

const logger = createStructuredLogger('inngest.reconcile');

/**
 * Reconciliation — only runs Inngest when monitoring is actively needed.
 *
 * 1. banTaskReconcile:
 *    Every 2 minutes, checks for ACTIVE agents that have BOTH an active task
 *    AND an active session. Only then kicks the agent loop. This prevents
 *    unnecessary tick-loop events when no session exists (user hasn't hired
 *    the agent yet, or session is expired/revoked).
 */

interface TaskLike {
  taskId?: string;
  agentId?: string;
  status?: string;
  config?: { expiresAtMs?: number };
}

async function hasActiveTask(agentId: string): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db
    .collection(collections.agentTasks ?? 'agent_tasks')
    .where('agentId', '==', agentId)
    .limit(20)
    .get();
  const now = Date.now();
  let active = false;
  snap.forEach((doc) => {
    const t = doc.data() as TaskLike;
    if (!t || t.status === 'FAILED') return;
    const expiresAt = t.config?.expiresAtMs ?? 0;
    if (expiresAt > now) active = true;
  });
  return active;
}

async function hasActiveSession(agentId: string): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db
    .collection(collections.agentSessions ?? 'agent_sessions')
    .where('agentId', '==', agentId)
    .where('status', '==', 'ACTIVE')
    .limit(5)
    .get();
  return !snap.empty;
}

export const banTaskReconcile = inngest.createFunction(
  {
    id: 'ban-task-reconcile',
    retries: 1,
    triggers: [{ cron: '*/2 * * * *' }],
    concurrency: 1,
  },
  async ({ step }) => {
    const correlationId = `reconcile_tasks_${Date.now()}`;
    logger.info('task_reconcile_started', { correlationId });

    const agents = await agentRegistry.list({ status: 'ACTIVE', limit: 50 });
    let kicked = 0;

    for (const agent of agents) {
      await step.run(`kick-${agent.id}`, async () => {
        // Only kick if BOTH an active task AND an active session exist
        const [activeTask, activeSession] = await Promise.all([
          hasActiveTask(agent.id),
          hasActiveSession(agent.id),
        ]);
        if (!activeTask) {
          return { agentId: agent.id, kicked: false, reason: 'no_active_task' };
        }
        if (!activeSession) {
          return { agentId: agent.id, kicked: false, reason: 'no_active_session' };
        }
        await inngest.send({
          name: 'ban/agent.tick-loop',
          data: {
            agentId: agent.id,
            userId: String(agent.ownerId ?? ''),
            correlationId: `reconcile_${Date.now()}`,
          },
        });
        logger.info('task_reconcile_kicked', { agentId: agent.id, correlationId });
        return { agentId: agent.id, kicked: true };
      });
      kicked += 1;
    }

    logger.info('task_reconcile_finished', { correlationId, agents: agents.length, kicked });
    return { ok: true, agents: agents.length, kicked };
  }
);

export const reconcileFunctions = [banTaskReconcile];