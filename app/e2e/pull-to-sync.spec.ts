import { expect, test, type Page } from '@playwright/test';
import { setUp } from './fake.ts';

async function drag(page: Page, from: { x: number; y: number }, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd',  y: number | null) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: y === null ? [] : [{ x: from.x, y }] });
  await send('touchStart', from.y);
  for (let i = 1; i <= 12; i++) await send('touchMove', from.y + (dy * i) / 12);
  await send('touchEnd', null);
}

test.beforeEach(({ browserName }, info) => {
  test.skip(info.project.name !== 'phone' || browserName !== 'chromium', 'phone only');
});

test('pulling down from the top checks for changes and never reloads the page', async ({ page }) => {
  await setUp(page);
  await page.evaluate(() => {
    const w = window as unknown as { __marker: string; __syncs: number };
    w.__marker = 'alive';
    w.__syncs = 0;
    const f = window.__bbFake;
    if (!f) return;
    const orig = f.vault.sync.bind(f.vault);
    f.vault.sync = () => {
      w.__syncs++;
      return orig();
    };
  });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe('contain');
  await drag(page, { x: 200, y: 120 }, 300);
  await expect(page.getByTestId('pull-to-sync')).toBeVisible();
  await expect(page.getByText('Up to date')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __syncs: number }).__syncs)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __marker: string }).__marker)).toBe('alive');
  await expect(page.getByTestId('pull-to-sync')).toHaveCount(0);
});

test('a short pull does nothing', async ({ page }) => {
  await setUp(page);
  await page.evaluate(() => ((window as unknown as { __syncs: number }).__syncs = 0));
  await drag(page, { x: 200, y: 120 }, 40);
  await expect(page.getByTestId('pull-to-sync')).toHaveCount(0);
});
