import { expect, test } from '@playwright/test';
import { expectNoViolations, openDemo } from './helpers.ts';

test('Add a wallet from Records, and from the Holdings card on desktop', async ({ page, isMobile }) => {
  await openDemo(page);
  if (isMobile !== true) {
    await page.getByRole('button', { name: 'Add a wallet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
    await sheet.getByLabel('Name').fill('Ledger');
    await sheet.getByRole('button', { name: 'Add wallet' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Wallets' }).getByText('Ledger')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a wallet' })).toBeFocused();
  }
  await page.goto('/records?v=wallets');
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name').fill('Old IRA');
  await sheet.getByRole('radio', { name: 'Retirement' }).click();
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('region', { name: 'Wallets' }).getByText('Old IRA')).toBeVisible();
  await expectNoViolations(page);
});

test('The oldest Strike buy can be edited even though sales picked its coins', async ({ page }) => {
  await openDemo(page);
  await page.goto('/wallet/wallet-strike');
  await expect(page.getByRole('region', { name: 'Entries' })).toBeVisible();
  const more = page.getByRole('button', { name: 'Show more' });
  while ((await more.count()) > 0) await more.click();
  await page.getByRole('region', { name: 'Entries' }).getByRole('button', { name: /^Bought/ }).last().click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const d = page.getByRole('dialog').last();
  await d.getByRole('button', { name: 'Review purchase' }).click();
  await expect(d.getByText('This cannot be saved yet')).toHaveCount(0);
  await d.getByLabel('Why are you changing it?').fill('Checked the receipt');
  await d.getByRole('button', { name: 'Save change' }).or(d.getByRole('button', { name: /^Save/ })).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
