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

test('a wallet opened from mid-Holdings starts at the top; the in-app Back and the browser Back both return to the place', async ({ page }) => {
  await openDemo(page);
  // Room to scroll on any screen size (a spacer outside the app), then stop with the wallet link part way down the screen.
  await page.evaluate(() => {
    const s = document.createElement('div');
    s.style.height = '3000px';
    document.body.append(s);
  });
  const wallet = page.getByRole('region', { name: 'Wallets' }).locator('a[href^="/wallet/"]').first();
  const top = await wallet.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
  const before = Math.max(250, top - 300);
  await scrollTo(page, before);

  // The real tap: the link is on screen where Holdings was left.
  await wallet.click();
  await expect(page).toHaveURL(/\/wallet\//);
  await expect.poll(() => y(page)).toBe(0);
  await scrollTo(page, 150);
  await page.getByRole('link', { name: 'Back', exact: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => Math.abs((await y(page)) - before)).toBeLessThan(8);

  // Again, with the browser's back.
  await wallet.click();
  await expect(page).toHaveURL(/\/wallet\//);
  await expect.poll(() => y(page)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => Math.abs((await y(page)) - before)).toBeLessThan(8);
  // Back went back in history: forward returns to the wallet, at the top where it was left.
  await page.goForward();
  await expect(page).toHaveURL(/\/wallet\//);
});

test('a link to a section (/settings#security) lands on that section', async ({ page }) => {
  await openDemo(page);
  await page.evaluate(() => window.scrollTo(0, 300));
  // An old Records link that the app sends on to /settings#security.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/records?v=security');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/settings#security$/);
  const heading = page.getByRole('heading', { name: 'Security and devices' });
  await expect(heading).toBeVisible();
  // At the top of the screen, or as near as the page's end allows.
  await expect
    .poll(() => heading.evaluate((el) => el.getBoundingClientRect().top < 200 || Math.ceil(window.scrollY) >= document.documentElement.scrollHeight - window.innerHeight - 1))
    .toBe(true);
  await expect(heading).toBeInViewport();
});
