import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['engine/test/**/*.test.ts', 'app/src/**/*.test.{ts,tsx}', 'worker/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The 100% gate covers the calculation engine only.
      include: ['engine/src/**/*.ts'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
});
