import { defineConfig } from '@playwright/test';

const PORT = 4173;
export const FAKE_PORT = 4174;

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
      command: process.env['CI'] ? 'npm run preview' : 'npm run build && npm run preview',
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env['CI'],
      stdout: 'ignore',
      timeout: 120_000,
    },
    {
      // The test-only build (fake server and authenticator, `--mode fake`). Never deployed.
      command: process.env['CI'] ? 'npm run preview:fake' : 'npm run build:fake && npm run preview:fake',
      url: `http://127.0.0.1:${FAKE_PORT}`,
      reuseExistingServer: !process.env['CI'],
      stdout: 'ignore',
      timeout: 120_000,
    },
  ],
});
