import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers.ts';

const y = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
const scrollTo = async (page: Page, top: number) => {
  await page.evaluate((t) => window.scrollTo(0, t), top);
  await expect.poll(() => y(page)).toBe(top);
  // Let the scroll event land before the next tap (a person is never faster than a frame).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
// Clicks are dispatched on the link itself: Playwright's own scroll-into-view would move the page before the tap
// (the desktop sidebar is sticky), and a real tap doesn't.
const tab = (page: Page, name: string) => {
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
  return { click: () => link.dispatchEvent('click') };
};

test('each tab keeps its own place, tapping the current tab goes to the top, and Back returns', async ({ page }) => {
  await openDemo(page);
  // Make every page tall enough to scroll (a spacer outside the app, sized through the style object).
  await page.evaluate(() => {
    const s = document.createElement('div');
    s.style.height = '3000px';
    document.body.append(s);
  });
  await scrollTo(page, 400);
  await tab(page, 'Records').click();
  await expect(page).toHaveURL(/\/records$/);
  await expect.poll(() => y(page)).toBe(0);
  await scrollTo(page, 250);
  await tab(page, 'Holdings').click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => y(page)).toBe(400);
  await tab(page, 'Records').click();
  await expect.poll(() => y(page)).toBe(250);

  // Tapping the tab you are on: top. At the top already: nothing.
  await tab(page, 'Records').click();
  await expect.poll(() => y(page)).toBe(0);
  await tab(page, 'Records').click();
  await expect.poll(() => y(page)).toBe(0);

  // A new page starts at the top; Back returns to the place.
  await tab(page, 'Holdings').click();
  await expect.poll(() => y(page)).toBe(400);
  await page.locator('a[href^="/wallet/"]').first().dispatchEvent('click');
  await expect(page).toHaveURL(/\/wallet\//);
  await expect.poll(() => y(page)).toBe(0);
  await scrollTo(page, 120);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => y(page)).toBe(400);
  await page.goForward();
  await expect.poll(() => y(page)).toBe(120);

  // A Records view is a drill-in: top, and Back restores.
  await tab(page, 'Records').click();
  await expect.poll(() => y(page)).toBe(0);
  await scrollTo(page, 300);
  await page.locator('a[href="/records?v=wallets"]').first().dispatchEvent('click');
  await expect(page).toHaveURL(/v=wallets/);
  await expect.poll(() => y(page)).toBe(0);
  await page.goBack();
  await expect.poll(() => y(page)).toBe(300);
});
