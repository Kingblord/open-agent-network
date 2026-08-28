import 'server-only';
import { serve } from 'inngest/next';
import { inngest } from '../../../inngest/client';
import { functions } from '../../../inngest/functions';

/**
 * Inngest worker serve route. Mounts the BAN Inngest functions so both the
 * local Inngest dev server and production can execute them.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});