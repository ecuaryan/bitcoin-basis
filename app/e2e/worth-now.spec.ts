import { expect, test } from '@playwright/test';
import { expectNoViolations, go, openDemo } from './helpers.ts';

const NOW_LINE = /Now \$[\d,]+\.\d\d · (up|down) \$[\d,]+\.\d\d \([+−]\d+%\)/;

// A lot row in the wallet's table, as a screen reader hears it: what it cost, what it is worth now, the gain and its percent.
const LOT_ROW = /Paid \$[\d,]+\.\d\d .*now \$[\d,]+\.\d\d (up|down) [+−]\$[\d,]+\.\d\d [+−]\d+%/;

test('Wallet: each lot shows what it is worth now, up or down, with the percent', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  const coins = page.getByRole('region', { name: 'Lots in this wallet' });
  await expect(coins.getByRole('button', { name: LOT_ROW }).first()).toBeVisible();
  // The percent is on screen on phones too, not only in the spoken name.
  await expect(coins.getByText(/^[+−]\d+%$/).first()).toBeVisible();
  await expectNoViolations(page);
});

test('Frozen wallet: its lots show no worth or gain, and its purchase says the coins are frozen, not gone', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-harbor');
  const coins = page.getByRole('region', { name: 'Lots in this wallet' });
  await expect(coins).toContainText('Frozen · not counted in what your Bitcoin is worth');
  await expect(coins.getByRole('button', { name: LOT_ROW })).toHaveCount(0);
  await page.getByRole('region', { name: 'Entries' }).getByRole('button', { name: /Bought/ }).first().click();
  const block = page.getByRole('dialog').getByRole('region', { name: 'What these coins are worth now' });
  await expect(block).toContainText('0.5000 0000 BTC of it is in a frozen wallet');
  await expect(block).not.toContainText('None of these coins are left');
  await expectNoViolations(page);
});

test('Entry: what these coins are worth now, and what already left', async ({ page }) => {
  await openDemo(page);
  await go(page, '/records?v=entries');
  await page.getByLabel('Kind').selectOption('bought');
  await page.getByRole('button', { name: /Bought/ }).first().click();
  const dialog = page.getByRole('dialog');
  const block = dialog.getByRole('region', { name: 'What these coins are worth now' });
  await expect(block).toBeVisible();
  await expect(block).toContainText('Cost');
  await expect(block).toContainText('Worth now');
  await expect(block).toContainText(/(up|down) \$/);
  await expectNoViolations(page);
});

test('Holdings: a year of coins shows a total and per-coin up or down', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /2025/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('2025 total')).toContainText(/(up|down) \$/);
  await expect(dialog.getByText(NOW_LINE).first()).toBeVisible();
  await expectNoViolations(page);
});
