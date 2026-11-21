/* global window */
// Saves screenshots of Holdings at phone and desktop size to app/e2e/screenshots/.
// Usage: from the repo root, with the app built and `npm run preview` running: `npm run screenshots -w @bitcoin-basis/app`
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const out = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(out, { recursive: true });
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173';

const browser = await chromium.launch();
for (const [name, viewport, extra] of [
  ['holdings-phone', { width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['holdings-desktop', { width: 1440, height: 1000 }, {}],
]) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block', ...extra });
  const page = await ctx.newPage();
  await page.addInitScript(() => window.localStorage.setItem('bb.hide', '0'));
  await page.goto(base);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.getByText('All your Bitcoin is worth', { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.screenshot({ path: join(out, `${name}-full.png`), fullPage: true });
  await ctx.close();
}
await browser.close();
console.log(`Saved to ${out}`);
