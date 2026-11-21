import { expect, test } from '@playwright/test';
import { expectNoViolations, go, openDemo } from './helpers.ts';

const NOW_LINE = /Now \$[\d,]+\.\d\d · (up|down) \$[\d,]+\.\d\d \([+−]\d+%\)/;

test('Wallet: each coin shows what it is worth now, up or down', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  const coins = page.getByRole('region', { name: 'Coins in this wallet' });
  await expect(coins.getByText(NOW_LINE).first()).toBeVisible();
  await expect(coins.getByText(/ · (up|down) /).first()).toBeVisible();
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
