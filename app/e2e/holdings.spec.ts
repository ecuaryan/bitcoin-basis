import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { setUp } from './fake.ts';
import { expectNoViolations, go, openDemo } from './helpers.ts';

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
  await expect(hero.getByText('$199,106')).toBeVisible();
  // 2.1 BTC in all: the demo's Easter egg.
  await expect(hero.getByText('2.1000 0000 BTC')).toBeVisible();
  await expect(hero).toContainText('up $110,473 (+125%) unrealized');
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
  await expect(taxable).toContainText('Counts for tax · 1.8500 BTC');
  // $175,402.95 + $23,703.10 = $199,106.05: the rows add up to the total ($175,403 + $23,703 = $199,106).
  await expect(page.getByRole('region', { name: 'What all your Bitcoin is worth' })).toContainText('$199,106');
  await expect(taxable).toContainText('$175,403');
  await expect(taxable).toContainText('up $99,090');
  const retirement = split.getByRole('link', { name: /^Retirement/ });
  await expect(retirement).toContainText('Kept apart from tax · 0.2500 BTC');
  await expect(retirement).toContainText('$23,703');
  await expect(retirement).toContainText('up $11,383');
  for (const row of [taxable, retirement]) expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  // The old bottom card and the line under the hero are gone.
  await expect(page.getByRole('region', { name: 'All your Bitcoin', exact: true })).toHaveCount(0);
  await expect(page.getByText(/with retirement/)).toHaveCount(0);

  // The taxable figures follow, with the gain called unrealized and explained.
  await expect(page.getByText('Gain on paper')).toHaveCount(0);
  await expect(page.getByText(/^Unrealized gain/)).toBeVisible();
  await page.getByRole('button', { name: 'What is an unrealized gain?' }).click();
  await expect(page.getByText('Unrealized: what you would gain if you sold today. No tax is due until you sell.')).toBeVisible();

  await taxable.click();
  await expect(page.getByRole('region', { name: 'Your taxable figures' })).toBeFocused();
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

test('Holdings runs most looked-at first; the stack by year is all your Bitcoin, retirement in its year and colour', async ({ page }) => {
  await openHoldingsWithDemo(page);
  const stack = page.getByRole('region', { name: 'Your coins by year bought' });
  await expect(stack.getByRole('heading', { name: 'Your stack, by year bought' })).toBeVisible();
  // Worth and gain, recent purchases, the loans, the split and taxable figures, wallets, then the look-back cards.
  await expect(page.getByRole('heading', { name: 'Taxable', exact: true })).toHaveCount(0);
  const y = async (l: Locator) => (await l.boundingBox())?.y ?? NaN;
  const order = [
    page.getByRole('region', { name: 'What all your Bitcoin is worth' }),
    page.getByRole('region', { name: 'Recent purchases' }),
    page.getByRole('region', { name: 'Loans' }).first(),
    page.getByRole('region', { name: 'Taxable and retirement' }),
    page.getByRole('region', { name: 'Your taxable figures' }),
    page.getByRole('region', { name: 'Wallets' }),
    stack,
    page.getByRole('region', { name: 'Average cost versus price' }),
  ];
  const ys = [];
  for (const l of order) ys.push(await y(l));
  for (let i = 1; i < ys.length; i++) expect(ys[i], `card ${i} comes after card ${i - 1}`).toBeGreaterThan(ys[i - 1] ?? Infinity);
  const docs = page.getByRole('region', { name: 'How well your taxable coins are documented' });
  expect(await y(docs)).toBeGreaterThanOrEqual(await y(page.getByRole('region', { name: 'Wallets' })));
  await expect(page.getByText('Held apart')).toHaveCount(0);

  await expect(stack).toContainText('Retirement');
  await expect(stack).toContainText('Taxable: 94% documented.');
  await expect(stack).not.toContainText('Not in a year');
  // 2024: the taxable lots (0.4000) plus the retirement purchase of Jan 18 (0.1000): 0.5000 BTC.
  const y2024 = stack.getByRole('button', { name: /Show the 2024 lots/ });
  await expect(y2024).toContainText('0.5000');
  await expect(y2024.locator('.bg-retire')).toHaveCount(1);
  await expect(stack.getByRole('button', { name: /Show the 2023 lots/ }).locator('.bg-retire')).toHaveCount(0);
  // Retirement has its own colour everywhere: the split bar and swatch too, never the Reconstructed cream.
  await expect(page.getByRole('region', { name: 'Taxable and retirement' }).locator('.bg-retire')).toHaveCount(2);

  await y2024.click();
  const sheet = page.getByRole('dialog', { name: '2024 lots' });
  const purchase = sheet.getByRole('button').filter({ hasText: 'Jan 18, 2024 · Retirement account' });
  await expect(purchase).toContainText('0.1000 0000');
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
  // Right under the hero, above the loans.
  const y = async (l: Locator) => (await l.boundingBox())?.y ?? NaN;
  expect(await y(card)).toBeGreaterThan(await y(page.getByRole('region', { name: 'What all your Bitcoin is worth' })));
  expect(await y(card)).toBeLessThan(await y(page.getByRole('region', { name: 'Loans' }).first()));
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
  await expect(card).toContainText('Average cost of all your Bitcoin: $42,206.11');
  await pick.getByRole('radio', { name: 'Taxable' }).click();
  await expect(card).toContainText('Average cost of your taxable Bitcoin: $41,250.18');
  await pick.getByRole('radio', { name: 'Retirement' }).click();
  // $4,120 + $4,200 + $4,000 = $12,320 for 0.25 BTC.
  await expect(card).toContainText('Average cost of your retirement Bitcoin: $49,280.00');
  expect((await new AxeBuilder({ page }).include('section[aria-label="Average cost versus price"]').analyze()).violations).toEqual([]);
});

test('Wallets: one aligned table whose rows add up to the total and the unrealized gain', async ({ page }) => {
  await openDemo(page);
  const card = page.getByRole('region', { name: 'Wallets' });
  const rows = card.getByRole('list', { name: 'Wallets, biggest first' }).getByRole('link');
  await expect(rows).toHaveCount(2);
  const total = card.getByRole('group', { name: 'All counted wallets' });
  await expect(total).toContainText('2 wallets');
  // Every wallet's worth and gain in whole dollars adds up to the total row.
  const dollars = async (loc: Locator, n: number) => Number(((await loc.innerText()).match(/[+−]?\$[\d,]+/g) ?? [])[n]?.replace(/[$,+]/g, '').replace('−', '-'));
  let worth = 0;
  let gain = 0;
  for (let i = 0; i < 2; i++) {
    worth += await dollars(rows.nth(i), 0);
    gain += await dollars(rows.nth(i), 1);
  }
  expect(worth).toBe(await dollars(total, 0));
  expect(gain).toBe(await dollars(total, 1));
  await expect(page.getByRole('region', { name: 'Your taxable figures' })).toContainText(`Unrealized gain on taxable Bitcoin`);
  // The BTC figures share one right edge, so the decimals line up.
  const rights = await card.locator('a > span:nth-child(3)').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  expect(new Set(rights).size).toBe(1);
  // The demo keeps it simple: no frozen wallet (log-wallet.spec freezes one and checks this list).
  await expect(card.getByRole('list', { name: 'Frozen wallets, not counted' })).toHaveCount(0);
  await expectNoViolations(page);
});

test('/demo is a link to share: it opens straight into the made-up demo, with no outside requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname !== '127.0.0.1') external.push(r.url());
  });
  await page.goto('/demo');
  await expect(page.getByText('All your Bitcoin is worth', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('region', { name: 'What all your Bitcoin is worth' })).toContainText('2.1000 0000 BTC');
  expect(external).toEqual([]);
});

test('/demo on a device with records open locks them first, and Exit demo goes back to the lock screen', async ({ page }) => {
  await setUp(page);
  await go(page, '/demo');
  await expect(page.getByText('All your Bitcoin is worth', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demo mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit demo' }).first().click();
  await expect(page.getByRole('button', { name: 'Show the demo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toHaveCount(0);
});

test('the lock screen can show the demo, to show someone on your own phone, and Exit demo locks again', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Lock' }).first().click();
  await page.getByRole('button', { name: 'Show the demo' }).click();
  await expect(page.getByText('All your Bitcoin is worth', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demo mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit demo' }).first().click();
  await expect(page.getByRole('button', { name: 'Show the demo' })).toBeVisible();
  await expect(page.getByText('All your Bitcoin is worth', { exact: true })).toHaveCount(0);
});
