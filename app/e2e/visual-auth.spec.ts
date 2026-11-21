import { expect, test, type Page } from '@playwright/test';
import { FAKE_URL, SETUP_CODE } from './fake.ts';

/**
 * Visual snapshots of first run, unlock and the printed kit (test-only build; random codes and today's
 * date are masked). Darwin baselines only, like visual.spec.ts: run with --grep @visual on a Mac.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
const opts = { animations: 'disabled', caret: 'hide', fullPage: true, maxDiffPixelRatio: 0.002 } as const;

async function claim(page: Page): Promise<void> {
  await page.goto(`${FAKE_URL}/`);
  await page.getByLabel('Setup code from your install script').fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Claim and create my passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
}

test.describe('@visual first run, unlock, kit', () => {
  test('@visual Welcome', async ({ page }) => {
    await page.goto(`${FAKE_URL}/`);
    await expect(page.getByRole('heading', { name: /on the record/ })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('welcome.png', opts);
  });

  test('@visual Setup: recovery code', async ({ page }) => {
    await claim(page);
    await settle(page);
    await expect(page).toHaveScreenshot('setup.png', { ...opts, mask: [page.getByRole('list', { name: /Recovery code, six groups/ })] });
  });

  test('@visual Unlock', async ({ page }) => {
    await claim(page);
    await page.getByRole('button', { name: "I've saved it" }).click();
    await page.getByRole('button', { name: 'Skip this check' }).click();
    await page.getByRole('button', { name: 'Skip anyway' }).click();
    await page.getByRole('button', { name: 'Add my first wallet' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a wallet' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('unlock.png', opts);
  });

  test('@visual Kit (letter, print)', async ({ page }) => {
    await claim(page);
    await page.getByRole('link', { name: 'Print the emergency kit' }).click();
    await expect(page.getByRole('article', { name: 'Emergency kit' })).toBeVisible();
    await page.setViewportSize({ width: 816, height: 1056 });
    await page.emulateMedia({ media: 'print' });
    await settle(page);
    const paper = page.getByRole('article', { name: 'Emergency kit' });
    await expect(page).toHaveScreenshot('kit.png', { ...opts, mask: [paper.getByRole('list', { name: 'Recovery code groups' }), paper.getByRole('img', { name: /QR code/ }), paper.getByText(/Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct/).filter({ hasText: /20\d\d/ })] });
  });
});
