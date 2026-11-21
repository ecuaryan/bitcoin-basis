import { expect, type Page } from '@playwright/test';

/** The test-only build (fake server and authenticator) lives on its own port. */
export const FAKE_URL = 'http://127.0.0.1:4174';
export const SETUP_CODE = 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234';

/** Walk through first-run setup on the fake build and land on the app. Returns the recovery code. */
export async function setUp(page: Page, { finish = true }: { finish?: boolean } = {}): Promise<string> {
  await page.goto(`${FAKE_URL}/`);
  await expect(page.getByRole('heading', { name: /on the record/ })).toBeVisible();
  await page.getByLabel('Setup code from your install script').fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Claim and create my passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
  const code = await readCode(page);
  if (finish) {
    await page.getByRole('button', { name: "I've saved it" }).click();
    await page.getByLabel('Group 4 of your recovery code').fill(code.split('-')[3] as string);
    await page.getByRole('button', { name: 'Continue' }).click();
    // "Add my first wallet" opens the Add-a-wallet sheet over Holdings; close it so tests start on the page.
    await page.getByRole('button', { name: 'Add my first wallet' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a wallet' })).toBeVisible();
    // Escape can land before the sheet has taken focus on a slow machine, so retry until it closes.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  }
  return code;
}

export async function readCode(page: Page): Promise<string> {
  const groups = await page.getByRole('list', { name: /Recovery code, six groups/ }).first().locator('li span.font-display').allInnerTexts();
  return groups.join('-');
}

/** Records → Security by tapping (the fake build keeps everything in the page, so never reload). */
export async function goSecurity(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Security/ }).click();
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
}
