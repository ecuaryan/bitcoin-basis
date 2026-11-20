import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['engine/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['engine/src/**/*.ts'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
});
