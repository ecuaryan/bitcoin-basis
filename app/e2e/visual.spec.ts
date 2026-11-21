import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers.ts';

/**
 * Visual snapshots of the key screens at both sizes. The demo book has a fixed price and a fixed
 * "today", and animations are off, so the pictures are stable. Baselines are platform-specific
 * (this machine's fonts): they are committed for darwin and CI skips them (`--grep-invert @visual`).
 * Update with: npm run e2e:visual:update -w @bitcoin-basis/app
 */

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', fullPage: true, maxDiffPixelRatio: 0.002 });
}

test.describe('@visual snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test('@visual Holdings', async ({ page }) => {
    await shot(page, 'holdings');
  });

  test('@visual Log sheet', async ({ page }) => {
    await page.getByRole('button', { name: 'Log something' }).or(page.getByRole('button', { name: 'Log', exact: true })).first().click();
    await expect(page.getByRole('dialog', { name: 'Log' }).getByLabel('Amount', { exact: true })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('log-sheet.png', { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002, mask: [page.locator('input[type="datetime-local"]')] });
  });

  test('@visual Sell', async ({ page }) => {
    await page.goto('/what-if');
    await expect(page.getByRole('radio', { name: 'Oldest first' })).toContainText('Tax this adds');
    await shot(page, 'sell');
  });

  test('@visual Borrow', async ({ page }) => {
    await page.goto('/what-if?mode=borrow');
    await expect(page.getByRole('region', { name: 'Loan vs. coin value' })).toContainText('26.4%');
    await shot(page, 'borrow');
  });

  test('@visual Tax season', async ({ page }) => {
    await page.goto('/tax');
    await expect(page.getByRole('region', { name: 'Digital asset question' })).toBeVisible();
    await shot(page, 'tax-season');
  });

  test('@visual Records', async ({ page }) => {
    await page.goto('/records?v=entries');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await shot(page, 'records');
  });

  test('@visual Wallet detail', async ({ page }) => {
    await page.goto('/wallet/wallet-strike');
    await expect(page.getByRole('region', { name: 'Entries' })).toBeVisible();
    await shot(page, 'wallet-detail');
  });
});
