import { expect, test } from '@playwright/test';
import { expectNoViolations, go, openDemo } from './helpers.ts';

test('Tax season: year view and 8949 download', async ({ page }) => {
  await openDemo(page);
  await go(page, '/tax');
  await expect(page.getByRole('region', { name: 'Digital asset question' })).toContainText('Answer: Yes');
  await expect(page.getByRole('region', { name: '1099-DA check' })).toContainText('Some exchanges report gifts to other users as sales');
  await expectNoViolations(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '8949 sales list' }).click()]);
  expect(download.suggestedFilename()).toBe('form-8949-2026.csv');
  await page.getByLabel('Tax year').selectOption('2025');
  await expect(page.getByRole('region', { name: 'Digital asset question' })).toContainText('Answer: Yes');
});

test('Tax season: close a year and unlock it with a reason', async ({ page }) => {
  await openDemo(page);
  await go(page, '/tax');
  // The current year can only be closed after it ends.
  await expect(page.getByText('You can close 2026 after you file.')).toBeVisible();
  await go(page, '/tax?year=2025');
  await page.getByRole('button', { name: /Close 2025 once/ }).click();
  await page.getByRole('dialog', { name: 'Close 2025?' }).getByRole('button', { name: 'Close 2025' }).click();
  await expect(page.getByText('2025 is closed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Unlock 2025/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock 2025?' });
  const unlock = dialog.getByRole('button', { name: 'Unlock 2025' });
  await expect(unlock).toBeDisabled();
  await expectNoViolations(page);
  await dialog.getByLabel('Why are you unlocking it?').fill('Late 1099-DA');
  await unlock.click();
  await expect(page.getByRole('button', { name: /Close 2025 once/ })).toBeVisible();
  await go(page, '/records?v=closed');
  await expect(page.getByRole('region', { name: 'Closing history' })).toContainText('Late 1099-DA');
});

test('Tax summary page prints for a CPA', async ({ page }) => {
  await openDemo(page);
  await go(page, '/tax/summary/2026');
  await expect(page.getByRole('heading', { name: 'Bitcoin tax year summary: 2026' })).toBeVisible();
  await expectNoViolations(page);
});
