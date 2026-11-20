/* global window */
// Saves screenshots of What if (Sell, Borrow), Tax season and Records at phone and desktop size, plus the approved
// mockups for comparison, to app/e2e/screenshots/. Needs the built app on `npm run preview` (port 4173).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const out = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(out, { recursive: true });
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const designs = process.env.DESIGN_DIR ?? '';

const pages = [
  ['sell', '/what-if'],
  ['borrow', '/what-if?mode=borrow'],
  ['tax', '/tax'],
  ['records', '/records'],
];
const sizes = [
  ['phone', { width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['desktop', { width: 1440, height: 1000 }, {}],
];

const browser = await chromium.launch();
for (const [size, viewport, extra] of sizes) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block', ...extra });
  const page = await ctx.newPage();
  await page.addInitScript(() => window.localStorage.setItem('bb.hide', '0'));
  await page.goto(base);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.getByText('Your Bitcoin is worth', { exact: true }).waitFor();
  for (const [name, path] of pages) {
    await page.goto(base + path);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(out, `${name}-${size}.png`) });
    await page.screenshot({ path: join(out, `${name}-${size}-full.png`), fullPage: true });
  }
  await ctx.close();
}
if (designs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  for (const [name, file] of [['sell', 'Sell'], ['borrow', 'Borrow'], ['tax', 'Tax'], ['records', 'Records']]) {
    await page.goto(pathToFileURL(join(designs, `${file}.dc.html`)).href);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `mockup-${name}.png`) });
  }
  await ctx.close();
}
await browser.close();
console.log(`Saved to ${out}`);
