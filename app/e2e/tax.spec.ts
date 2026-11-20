import { expect, test } from '@playwright/test';
import { expectNoViolations, openDemo } from './helpers.ts';

test('Tax season: year view and 8949 download', async ({ page }) => {
  await openDemo(page);
  await page.goto('/tax');
  await expect(page.getByRole('region', { name: 'Digital asset question' })).toContainText('Answer: Yes');
  await expect(page.getByRole('region', { name: '1099-DA check' })).toContainText('gifts sent to other users as sales');
  await expectNoViolations(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '8949 sales list' }).click()]);
  expect(download.suggestedFilename()).toBe('form-8949-2026.csv');
  await page.getByLabel('Tax year').selectOption('2025');
  await expect(page.getByRole('region', { name: 'Digital asset question' })).toContainText('Answer: Yes');
});

test('Tax season: close a year and unlock it with a reason', async ({ page }) => {
  await openDemo(page);
  await page.goto('/tax');
  await page.getByRole('button', { name: /Close 2026 once/ }).click();
  await page.getByRole('dialog', { name: 'Close 2026?' }).getByRole('button', { name: 'Close 2026' }).click();
  await expect(page.getByText('2026 is closed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Unlock 2026/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock 2026?' });
  const unlock = dialog.getByRole('button', { name: 'Unlock 2026' });
  await expect(unlock).toBeDisabled();
  await expectNoViolations(page);
  await dialog.getByLabel('Why are you unlocking it?').fill('Late 1099-DA');
  await unlock.click();
  await expect(page.getByRole('button', { name: /Close 2026 once/ })).toBeVisible();
  await page.goto('/records?v=closed');
  await expect(page.getByRole('region', { name: 'Closing history' })).toContainText('Late 1099-DA');
});

test('Tax summary page prints for a CPA', async ({ page }) => {
  await openDemo(page);
  await page.goto('/tax/summary/2026');
  await expect(page.getByRole('heading', { name: 'Bitcoin tax year summary: 2026' })).toBeVisible();
  await expectNoViolations(page);
});
