import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Vitest (Vite) does NOT load .env.local — that's a Next.js feature.
// Load it explicitly so Firebase Admin credentials reach process.env for the
// live Firestore integration legs (M2 Option C).
loadEnv({ path: resolve(process.cwd(), '.env.local') });