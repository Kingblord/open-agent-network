import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    isolate: true,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});