import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Open the app with the demo book, amounts shown. Network calls to mempool.space are never made (demo uses a fixed price). */
export async function openHoldingsWithDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('bb.hide', '0');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
}

test('Holdings loads with demo data and has no accessibility violations', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1') external.push(r.url());
  });
  await openHoldingsWithDemo(page);

  await expect(page.getByText('$319,206')).toBeVisible();
  await expect(page.getByText('3.3667 2105 BTC')).toBeVisible();
  await expect(page.getByText(/186 lots/)).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
  expect(external, 'the demo makes no outside requests').toEqual([]);
});

test('hidden amounts and the year sheet are accessible too', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
  // Amounts show by default; hiding is the user's choice.
  await expect(page.getByText('$•••,•••', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide amounts' }).first().click();
  await expect(page.getByText('$•••,•••', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Show where the .*2023 coins came from/ }).click();
  await expect(page.getByRole('dialog', { name: '2023 coins' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('every screen names itself in the browser tab', async ({ page }) => {
  await openHoldingsWithDemo(page);
  await expect(page).toHaveTitle('Holdings · Bitcoin Basis');
  for (const [path, title] of [
    ['/what-if', 'What if'],
    ['/tax', 'Tax season'],
    ['/records', 'Records'],
    ['/records?v=security', 'Security'],
    ['/wallet/wallet-strike', 'Strike'],
    ['/kit', 'Emergency kit'],
    ['/nowhere', 'Not found'],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${title} · Bitcoin Basis`);
  }
});
