import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Open the app with the demo book loaded and amounts shown. */
export async function openDemo(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('bb.hide', '0'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
}

export async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
}
