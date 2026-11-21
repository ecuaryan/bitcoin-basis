import { defineConfig } from '@playwright/test';

// Live end-to-end run against a real deployed (staging) Worker, with two or more "devices" simulated by
// separate browser contexts that each get a virtual passkey authenticator. Never part of `npm run e2e`.
//   BB_LIVE_URL=https://<staging-origin> BB_LIVE_SETUP_CODE=XXXX-... npx playwright test -c playwright.live.config.ts
// Optional server-side check of the encrypted bucket: BB_LIVE_CF_ACCOUNT, BB_LIVE_DATA_BUCKET (needs `wrangler login`).
// Optional: BB_LIVE_SHOTS=<dir> to save screenshots, BB_LIVE_WRANGLER=<path to wrangler>.
export default defineConfig({
  testDir: 'e2e-live',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: 'test-results-live',
  use: { colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
