import { defineConfig } from '@playwright/test';

const PORT = 4173;

// Both projects run against the built app served by `vite preview` (so the strict CSP is in force).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
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
  webServer: {
    command: 'npm run build && npm run preview',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
