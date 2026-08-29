import 'server-only';
import { Inngest, eventType } from 'inngest';
import { z } from 'zod';

/**
 * BAN Inngest client (durable job boundary). All asynchronous worker
 * functions use this client.
 *
 * M2: each queue gets a typed event carrying the jobId + idempotency key so
 * the worker can claim/persist/dedup/retry via Firestore.
 *
 * NOTE: Inngest's `eventType` schema layer rejects Zod schemas that use
 * `.default()` (they produce a transform). Field defaults are therefore
 * applied in the worker, not at the schema boundary.
 */

export const banPingEvent = eventType('ban/m1.ping', {
  schema: z.object({ correlationId: z.string().optional() }),
});

// Zod v4: `record` requires (keySchema, valueSchema).
export const JOB_PAYLOAD_SCHEMA = z.record(z.string(), z.unknown());

export const banJobEvent = eventType('ban/job', {
  schema: z.object({
    jobType: z.enum([
      'agent-observation',
      'agent-decision',
      'agent-execution',
      'market-data',
      'position-sync',
      'performance',
    ]),
    jobId: z.string().min(1),
    agentId: z.string().min(1),
    userId: z.string().min(1),
    correlationId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    attempt: z.number().int().min(1).optional(),
    payload: JOB_PAYLOAD_SCHEMA.optional(),
  }),
});

// ---------------------------------------------------------------------------
// Inngest Cloud credentials (2-minute ban-agent-tick cron).
//
// The cron is scheduled by Inngest Cloud; the SDK requires an event key to
// sign/register events and a signing key to verify webhooks. Both are read
// exclusively from environment variables — set them on Vercel:
//
//   INNGEST_EVENT_KEY   — app.inngest.com → your app → Settings → Environments
//   INNGEST_SIGNING_KEY — same screen
//
// No hardcoded fallbacks: if either var is missing the SDK falls back to
// dev mode (local Dev Server only) and the cloud cron will not fire.
// ---------------------------------------------------------------------------
export const inngest = new Inngest({
  id: 'ban-smart-money',
  name: 'BAN Smart Money',
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});