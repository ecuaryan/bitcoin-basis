import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { setUp } from './fake.ts';
import { go, openDemo } from './helpers.ts';

/** Open the app with the demo book, amounts shown. Network calls to mempool.space are never made (demo uses a fixed price). */
export async function openHoldingsWithDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('bb.hide', '0');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('All your Bitcoin is worth', { exact: true })).toBeVisible();
}

test('Holdings loads with demo data and has no accessibility violations', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1') external.push(r.url());
  });
  await openHoldingsWithDemo(page);

  // The demo has a retirement account, so the hero is all of it: taxable plus retirement.
  const hero = page.getByRole('region', { name: 'What all your Bitcoin is worth' });
  await expect(hero.getByText('$352,391')).toBeVisible();
  await expect(hero.getByText('3.7167 2105 BTC')).toBeVisible();
  await expect(hero).toContainText('up $197,603 (+127%) unrealized');
  await expect(page.getByRole('heading', { name: 'Your stack, by year bought' })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
  expect(external, 'the demo makes no outside requests').toEqual([]);
});

test('hidden amounts and the year sheet are accessible too', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('All your Bitcoin is worth', { exact: true })).toBeVisible();
  // Amounts show by default; hiding is the user's choice.
  await expect(page.getByText('$•••••', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide amounts' }).first().click();
  await expect(page.getByText('$•••••', { exact: true }).first()).toBeVisible();
  // Every figure at the top hides too (the market price is public and stays).
  const top = page.getByRole('region', { name: 'What all your Bitcoin is worth' });
  await expect(top).toContainText('unrealized');
  await expect(top).not.toContainText('352,391');
  await expect(top).not.toContainText('3.7167');
  await expect(top).not.toContainText('197,603');
  await expect(top).not.toContainText('127%');
  const split = page.getByRole('region', { name: 'Taxable and retirement' });
  await expect(split).toContainText('Counts for tax');
  await expect(split).not.toContainText(/\$\d|\d\.\d{4}|%/);
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
    ['/settings', 'Settings'],
    ['/wallet/wallet-strike', 'Strike'],
    ['/kit', 'Emergency kit'],
    ['/nowhere', 'Not found'],
  ] as const) {
    await go(page, path);
    await expect(page).toHaveTitle(`${title} · Bitcoin Basis`);
  }
});

test('Holdings with a retirement account: all your Bitcoin on top, split into taxable and retirement, then the taxable figures', async ({ page }) => {
  await openHoldingsWithDemo(page);
  const split = page.getByRole('region', { name: 'Taxable and retirement' });
  const taxable = split.getByRole('button', { name: /^Taxable/ });
  await expect(taxable).toContainText('Counts for tax · 3.3667 BTC');
  await expect(taxable).toContainText('$319,206');
  await expect(taxable).toContainText('up $180,329');
  const retirement = split.getByRole('link', { name: /^Retirement/ });
  await expect(retirement).toContainText('Kept apart from tax · 0.3500 BTC');
  await expect(retirement).toContainText('$33,184');
  await expect(retirement).toContainText('up $17,274');
  for (const row of [taxable, retirement]) expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  // The old bottom card and the line under the hero are gone.
  await expect(page.getByRole('region', { name: 'All your Bitcoin', exact: true })).toHaveCount(0);
  await expect(page.getByText(/with retirement/)).toHaveCount(0);

  // The taxable figures follow under their own label, with the gain called unrealized and explained.
  await expect(page.getByText('Gain on paper')).toHaveCount(0);
  await expect(page.getByText(/^Unrealized gain/)).toBeVisible();
  await page.getByRole('button', { name: 'What is an unrealized gain?' }).click();
  await expect(page.getByText('Unrealized: what you would gain if you sold today. No tax is due until you sell.')).toBeVisible();

  await taxable.click();
  await expect(page.getByRole('heading', { name: 'Taxable', exact: true })).toBeFocused();
  await retirement.click();
  await expect(page).toHaveURL(/\/wallet\/wallet-retirement$/);
  await expect(page.getByRole('region', { name: 'Balance', exact: true })).toContainText('unrealized');
});

test('Holdings without a retirement account looks as before: the hero is taxable, no split', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Add a wallet' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name', { exact: true }).fill('Kraken');
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const log = page.getByRole('dialog', { name: 'Log' });
  await log.getByLabel('Amount', { exact: true }).fill('0.01');
  await log.getByLabel('Total paid, including fees').fill('500');
  await log.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page.getByRole('region', { name: 'What your Bitcoin is worth' })).toContainText('0.0100 0000 BTC');
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
  await expect(page.getByText(/unrealized$/)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Taxable and retirement' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Taxable', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Unrealized gain/)).toBeVisible();
});

test('the all-Bitcoin hero shows the average cost of all your Bitcoin', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText(/Average cost \$[\d,]+\.\d\d per BTC/).first()).toBeVisible();
});
