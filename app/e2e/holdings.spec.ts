import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
  await expect(hero).toContainText('up $197,603 (+128%) unrealized');
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
  await page.getByRole('button', { name: /Show the 2023 lots and where each came from/ }).click();
  await expect(page.getByRole('dialog', { name: '2023 lots' })).toBeVisible();
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
  // $319,206.94 + $33,184.34 = $352,391.28: the rows add up to the total ($319,207 + $33,184 = $352,391).
  await expect(page.getByRole('region', { name: 'What all your Bitcoin is worth' })).toContainText('$352,391');
  await expect(taxable).toContainText('$319,207');
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
  await expect(page.getByText(/Average cost of all your Bitcoin: \$[\d,]+\.\d\d per BTC/).first()).toBeVisible();
});

test('Your stack, by year bought is all your Bitcoin: above the taxable figures, retirement in its year and colour', async ({ page }) => {
  await openHoldingsWithDemo(page);
  const stack = page.getByRole('region', { name: 'Your coins by year bought' });
  await expect(stack.getByRole('heading', { name: 'Your stack, by year bought' })).toBeVisible();
  // Whole picture: above the Taxable label. The documentation card stays below it and says it is taxable only.
  const divider = page.getByRole('heading', { name: 'Taxable', exact: true });
  expect((await stack.boundingBox())?.y ?? Infinity).toBeLessThan((await divider.boundingBox())?.y ?? 0);
  const docs = page.getByRole('region', { name: 'How well your taxable coins are documented' });
  expect((await docs.boundingBox())?.y ?? 0).toBeGreaterThan((await divider.boundingBox())?.y ?? Infinity);
  // The chart, retirement and loans are the whole picture too; wallets and the taxable figures count for tax.
  const y = async (l: Locator) => (await l.boundingBox())?.y ?? NaN;
  const d = await y(divider);
  for (const above of ['Average cost versus price', 'Retirement accounts', 'Recent purchases']) expect(await y(page.getByRole('region', { name: above }))).toBeLessThan(d);
  expect(await y(page.getByRole('region', { name: 'Wallets' }))).toBeGreaterThan(d);
  await expect(page.getByText('Held apart')).toHaveCount(0);

  await expect(stack).toContainText('Retirement');
  await expect(stack).toContainText('Taxable: 94% documented.');
  await expect(stack).not.toContainText('Not in a year');
  // 2024: the taxable lots (0.6911 2…) plus the retirement purchase of Jan 18 (0.1650): 0.8561 BTC.
  const y2024 = stack.getByRole('button', { name: /Show the 2024 lots/ });
  await expect(y2024).toContainText('0.8561');
  await expect(y2024.locator('.bg-retire')).toHaveCount(1);
  await expect(stack.getByRole('button', { name: /Show the 2023 lots/ }).locator('.bg-retire')).toHaveCount(0);
  // Retirement has its own colour everywhere: the split bar and swatch too, never the Reconstructed cream.
  await expect(page.getByRole('region', { name: 'Taxable and retirement' }).locator('.bg-retire')).toHaveCount(2);

  await y2024.click();
  const sheet = page.getByRole('dialog', { name: '2024 lots' });
  const purchase = sheet.getByRole('button').filter({ hasText: 'Jan 18, 2024 · Retirement account' });
  await expect(purchase).toContainText('0.1650 0000');
  await expect(purchase).toContainText('Retirement');
  await expect(purchase).toContainText(/Now \$[\d,]+\.\d\d · up \$[\d,]+\.\d\d \(\+\d+%\)/);
  await purchase.click();
  await expect(sheet).toContainText('Retirement purchase in Retirement account. Kept apart from tax.');
  await expect(sheet.getByRole('img', { name: 'Amount hidden' })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);

  // Hide amounts masks the retirement figures in the sheet and on the card.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Hide amounts' }).first().click();
  await expect(stack).not.toContainText(/\d\.\d{4}/);
  await y2024.click();
  await sheet.getByRole('button').filter({ hasText: 'Jan 18, 2024 · Retirement account' }).click();
  await expect(sheet).toContainText('Kept apart from tax.');
  await expect(sheet).not.toContainText(/\$\d|\d\.\d{4}|\d%/);
});

test('Recent purchases: the latest five, newest first, with worth now and the percent; a row opens the purchase', async ({ page }) => {
  await openHoldingsWithDemo(page);
  const card = page.getByRole('region', { name: 'Recent purchases' });
  const list = card.getByRole('list', { name: 'Purchases, newest first' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  // Under the chart and the retirement accounts, above the loans and the taxable figures.
  const y = async (l: Locator) => (await l.boundingBox())?.y ?? NaN;
  expect(await y(card)).toBeGreaterThan(await y(page.getByRole('region', { name: 'Retirement accounts' })));
  const rows = list.getByRole('button');
  await expect(rows.first()).toHaveAccessibleName(/Paid \$[\d,]+\.\d\d .*now \$[\d,]+\.\d\d (up|down) [+−]\$[\d,]+\.\d\d [+−]\d+%.*Strike/);
  await expect(card.getByText(/^[+−]\d+%$/).first()).toBeVisible();
  await card.getByRole('button', { name: 'Show 10 more' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(15);
  await rows.first().click();
  await expect(page.getByRole('dialog')).toContainText('Bought');
  await page.keyboard.press('Escape');
  const results = await new AxeBuilder({ page }).include('section[aria-label="Recent purchases"]').analyze();
  expect(results.violations).toEqual([]);
});

test('the chart’s average-cost line switches between all your Bitcoin, taxable and retirement, and says which it is', async ({ page }) => {
  await openHoldingsWithDemo(page);
  const card = page.getByRole('region', { name: 'Average cost versus price' });
  const pick = card.getByRole('radiogroup', { name: 'Average cost line for' });
  await expect(pick.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
  await expect(card).toContainText('Average cost of all your Bitcoin: $41,646.35');
  await pick.getByRole('radio', { name: 'Taxable' }).click();
  await expect(card).toContainText('Average cost of your taxable Bitcoin: $41,250.18');
  await pick.getByRole('radio', { name: 'Retirement' }).click();
  await expect(card).toContainText('Average cost of your retirement Bitcoin: $45,457.14');
  expect((await new AxeBuilder({ page }).include('section[aria-label="Average cost versus price"]').analyze()).violations).toEqual([]);
});
