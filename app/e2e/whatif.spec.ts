import { expect, test } from '@playwright/test';
import { expectNoViolations, go, openDemo } from './helpers.ts';

test('Sell: compare, slide, pick coins and log a sale', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if');
  const oldest = page.getByRole('radio', { name: 'Oldest first' });
  const lowest = page.getByRole('radio', { name: 'Lowest tax' });
  await expect(oldest).toContainText('Tax this adds');
  await expect(lowest).toContainText('Losses left for next year');
  await page.getByText('Why?', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'What this means' })).toContainText('Estimates, not tax advice');
  await expectNoViolations(page);

  const slider = page.getByRole('slider', { name: 'Amount to sell' });
  const big = page.getByRole('region', { name: 'Amount to sell' });
  const before = await big.innerText();
  await slider.press('End');
  await expect(big).not.toHaveText(before);

  await page.getByRole('button', { name: 'Pick lots' }).click();
  await expect(page.getByRole('dialog', { name: 'Pick lots' })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Use these lots' }).click();
  await expect(page.getByRole('radio', { name: 'Lots you picked' })).toBeVisible();

  await page.getByRole('button', { name: 'I sold it, log it' }).click();
  const review = page.getByRole('dialog', { name: 'Log your sale' });
  await expect(review).toContainText('Estimated tax it adds');
  await expectNoViolations(page);
  await review.getByRole('button', { name: 'Save sale' }).click();
  await expect(page.getByText('Sale saved.')).toBeVisible();

  await go(page, '/records?v=entries&search=1');
  await page.getByRole('searchbox', { name: 'Search entries' }).fill('sold');
  await expect(page.getByRole('button', { name: /Sold/ }).first()).toBeVisible();
});

test('Sell from self-custody offers to prepare a sale', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if');
  await page.getByRole('button', { name: /Selling from|·.*BTC/ }).first().click();
  await page.getByRole('button', { name: /Cold storage/ }).click();
  await expect(page.getByRole('button', { name: 'Prepare this sale' })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare this sale' }).click();
  const sheet = page.getByRole('dialog', { name: 'Prepare this sale' });
  await expect(sheet).toContainText('Coins arriving');
  await expectNoViolations(page);
  await sheet.getByRole('button', { name: 'Save this move' }).click();
  await expect(page.getByText(/Move logged/)).toBeVisible();
});

test('Borrow: loan-to-value, price scale and a saved scenario', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if?mode=borrow');
  const ltv = page.getByRole('region', { name: 'Loan vs. coin value' });
  await expect(ltv).toContainText('26.4%');
  await expect(ltv).toContainText('$31,250');
  await expect(page.getByRole('region', { name: 'Costs' })).toContainText('$2,875');
  await expectNoViolations(page);
  await page.getByLabel('Borrow', { exact: true }).fill('50000');
  await expect(ltv).toContainText('52.7%');
  await page.getByLabel('Borrow', { exact: true }).fill('abc');
  await expect(page.getByRole('alert')).toContainText('dollars');
  await page.getByLabel('Borrow', { exact: true }).fill('25000');
  await page.getByRole('button', { name: 'Save this scenario' }).click();
  await expect(page.getByRole('region', { name: 'Saved scenarios' })).toBeVisible();
});
