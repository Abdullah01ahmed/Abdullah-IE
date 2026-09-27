import { defineConfig } from 'vitest/config';

// One vitest config for the whole monorepo. Each package is a "project" so
// `vitest run --project server` works from the package scripts, while a bare
// `npm test` at the root runs everything except the (slow, browser-driving)
// end-to-end suite, which is opt-in via `npm run e2e`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: 'packages/shared',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'server',
          root: 'packages/server',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'client',
          root: 'packages/client',
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
      {
        test: {
          name: 'e2e',
          root: 'e2e',
          include: ['**/*.e2e.ts'],
          environment: 'node',
          testTimeout: 180_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
