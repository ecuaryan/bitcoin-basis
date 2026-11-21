import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Open the app with the demo book loaded and amounts shown. */
export async function openDemo(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('bb.hide', '0'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
}

export async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
}

/**
 * Move to another address inside the running app. The demo lives only in memory, so a full page load (`page.goto`)
 * would start it over; this changes the address the way a link click does.
 */
export async function go(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
