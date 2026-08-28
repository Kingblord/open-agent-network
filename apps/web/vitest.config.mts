import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // M2's live Firestore integration round-trips can exceed the default 5s,
    // especially when all suites run in parallel. Bump generously so those
    // durable-state-machine tests don't false-fail on wall-clock timeouts.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      // Let server-only modules (firebase-admin, job-repo) load in tests.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});