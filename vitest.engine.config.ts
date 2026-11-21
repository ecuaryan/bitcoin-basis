// Engine-only vitest config used by Stryker mutation testing (`npm run mutate`).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['engine/test/**/*.test.ts'] },
});
