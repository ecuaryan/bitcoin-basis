import { defineConfig } from '@playwright/test';

// Other ports when the usual ones are taken (for example by a preview left running): BB_E2E_PORT, BB_E2E_FAKE_PORT.
const PORT = Number(process.env['BB_E2E_PORT'] ?? 4173);
export const FAKE_PORT = Number(process.env['BB_E2E_FAKE_PORT'] ?? 4174);

// Both projects run against the built app served by `vite preview` (so the strict CSP is in force).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: [
    {
      // CI builds first (separate step); locally the build runs here so the preview is never stale.
      command: `${process.env['CI'] ? '' : 'npm run build && '}npx vite preview --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env['CI'],
      stdout: 'ignore',
      timeout: 120_000,
    },
    {
      // The test-only build (fake server and authenticator, `--mode fake`). Never deployed.
      command: `${process.env['CI'] ? '' : 'npm run build:fake && '}npx vite preview --outDir dist-fake --port ${FAKE_PORT} --strictPort`,
      url: `http://127.0.0.1:${FAKE_PORT}`,
      reuseExistingServer: !process.env['CI'],
      stdout: 'ignore',
      timeout: 120_000,
    },
  ],
});
