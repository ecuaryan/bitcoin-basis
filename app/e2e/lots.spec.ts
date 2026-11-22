import { expect, test, type Locator } from '@playwright/test';
import { LOT_HELP } from '../src/lib/terms.ts';
import { expectNoViolations, go, openDemo } from './helpers.ts';

/** The one "What is a lot?" explainer: closed at first, opens in place. */
async function explains(scope: Locator, name: string | RegExp = 'What is a lot?'): Promise<void> {
  await expect(scope.getByText(LOT_HELP)).toHaveCount(0);
  await scope.getByRole('button', { name }).click();
  await expect(scope.getByText(LOT_HELP, { exact: false })).toBeVisible();
}

test('lots: the wallet page lists lots, newest first, with the one explainer', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  const lots = page.getByRole('region', { name: 'Lots in this wallet' });
  await expect(lots.getByRole('heading', { name: 'Lots, newest first' })).toBeVisible();
  await expect(lots).not.toContainText(/coins?\b/i);
  await explains(lots, /What is a lot\?*, and what are short-term and long-term\?/);
  await expect(lots).toContainText('Long-term:');
  await expectNoViolations(page);
});

test('lots: the wallet table groups short-term then long-term, totals every lot, and opens a row', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  const lots = page.getByRole('region', { name: 'Lots in this wallet' });
  const short = lots.getByRole('list', { name: 'Short-term lots' });
  await expect(short.getByRole('listitem')).toHaveCount(8);
  await expect(short.getByText(/^Long-term on [A-Z][a-z]{2} \d{1,2}, \d{4}$/).first()).toBeVisible();
  // One line for every lot in the wallet, not only the ones shown.
  const total = lots.getByRole('group', { name: 'All lots in this wallet' });
  await expect(total).toContainText(/\d+ lots/);
  await expect(total).toContainText(/avg \$[\d,]+/);
  await expect(total.getByText(/^[+−]\d+%$/)).toBeVisible();
  // A row opens in place to say where the lot came from.
  const first = short.getByRole('button').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(short.getByText('Came from')).toBeVisible();
  await lots.getByRole('button', { name: /^Show all \d+ lots$/ }).click();
  await expect(lots.getByRole('list', { name: 'Long-term lots' })).toBeVisible();
  await expectNoViolations(page);
});

test('lots: the wallet table fits the screen and keeps its columns lined up', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  const lots = page.getByRole('region', { name: 'Lots in this wallet' });
  const table = lots.locator('.grid').first();
  await expect(table).toBeVisible();
  expect(await table.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  // Every row's "Paid" ends at the same x as the column heading's.
  const rights = await lots.getByText(/^Paid \$/).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  expect(new Set(rights).size).toBe(1);
});

test('lots: the year sheet counts lots and explains them', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /Show the 2023 lots and where each came from/ }).click();
  const sheet = page.getByRole('dialog', { name: '2023 lots' });
  await expect(sheet).toContainText(/\d+ lots, newest first/);
  await expect(sheet).toContainText('All 2023 lots now');
  await explains(sheet);
  await expectNoViolations(page);
});

test('lots: picking lots for a sale (Sell planner and the Log form) says lots, with the explainer', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if');
  await page.getByRole('button', { name: 'Pick lots' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pick lots' });
  await expect(sheet).toContainText('Tick the lots to sell. The last one is trimmed to fit.');
  await expect(sheet.getByRole('status')).toContainText(/\d+ lots? ticked/);
  await explains(sheet);
  await expectNoViolations(page);
  await sheet.getByRole('button', { name: 'Use these lots' }).click();
  await expect(page.getByRole('radio', { name: 'Lots you picked' })).toContainText('Lots used');

  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const log = page.getByRole('dialog', { name: 'Log' });
  await log.getByRole('tab', { name: 'Sold' }).click();
  await log.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await log.getByLabel('Amount', { exact: true }).fill('0.002');
  const which = log.getByRole('group', { name: /Which lots/ });
  await expect(which).toContainText(/Uses \d+ lots?, oldest first/);
  await explains(which);
  await which.getByRole('radio', { name: 'Pick lots' }).click();
  await expect(which.getByRole('list', { name: 'Lots in this wallet' })).toBeVisible();
  await expectNoViolations(page);
});
