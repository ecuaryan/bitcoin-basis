import { expect, test, type Page } from '@playwright/test';
import { DEMO_PRICE_CENTS } from '../src/demo/demo-data.ts';
import { formatMoney } from '../src/lib/format.ts';
import { setUp } from './fake.ts';
import { expectNoViolations, go } from './helpers.ts';

/** The test build's own price endpoints answer the demo's fixed price (see test-support/fake-boot.ts). */
const PRICE = formatMoney(DEMO_PRICE_CENTS);

async function addWallet(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add a wallet' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function logPurchase(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const log = page.getByRole('dialog', { name: 'Log' });
  await log.getByLabel('Amount', { exact: true }).fill('0.01');
  await log.getByLabel('Total paid, including fees').fill('500');
  await log.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Make the price endpoints fail (503) or work again. */
async function priceDown(page: Page, down: boolean): Promise<void> {
  await page.evaluate((d) => {
    const failing = window.__bbFake?.server.failing;
    for (const path of ['/api/price', '/api/price/history']) {
      if (d) failing?.set(path, 503);
      else failing?.delete(path);
    }
  }, down);
}

test('the test build serves a fixed price, so Holdings and Sell show real figures', async ({ page }) => {
  await setUp(page);
  await addWallet(page, 'Kraken');
  await logPurchase(page);
  await expect(page.getByText(`at ${PRICE}`).first()).toBeVisible();
  await go(page, '/what-if');
  await expect(page.getByRole('region', { name: 'Amount to sell' })).toContainText(`at ${PRICE}`);
});

test('no price: a plain message with Retry, or a price you enter, labeled as yours everywhere it is used', async ({ page }) => {
  await setUp(page);
  await priceDown(page, true);
  await addWallet(page, 'Kraken');
  await logPurchase(page);

  // Holdings: the one message, Retry, and "Use a price I enter".
  await expect(page.getByText('Can’t load today’s Bitcoin price.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
  await expectNoViolations(page);

  // Sell explains it needs a price, and offers the same.
  await go(page, '/what-if');
  const price = page.getByRole('region', { name: 'Price' });
  await expect(price).toContainText('Can’t load today’s Bitcoin price.');
  await expect(price).toContainText('Selling needs a price');
  await expectNoViolations(page);
  await price.getByRole('button', { name: 'Use a price I enter' }).click();
  const sheet = page.getByRole('dialog', { name: 'Use a price I enter' });
  await sheet.getByLabel('Price of 1 BTC').fill('90000');
  await expectNoViolations(page);
  await sheet.getByRole('button', { name: 'Use this price' }).click();
  await expect(page.getByRole('region', { name: 'Amount to sell' })).toContainText('at your price $90,000.00');
  const banner = page.getByRole('region', { name: 'Your price' });
  await expect(banner).toContainText('Using your price $90,000.00 per BTC. Not saved.');
  await go(page, '/');
  await expect(page.getByText('Using your price $90,000.00').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your price' })).toBeVisible();

  // Stop goes back to asking; Retry picks the live price up once it answers again.
  await page.getByRole('region', { name: 'Your price' }).getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('region', { name: 'Your price' })).toHaveCount(0);
  await expect(page.getByText('Can’t load today’s Bitcoin price.').first()).toBeVisible();
  await priceDown(page, false);
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await expect(page.getByText(`at ${PRICE}`).first()).toBeVisible();
});

test('a price you enter is used for a purchase in dollars only if you save it, and the note says it was yours', async ({ page }) => {
  await setUp(page);
  await priceDown(page, true);
  await addWallet(page, 'Kraken');
  await logPurchase(page);
  await page.getByRole('button', { name: 'Use a price I enter' }).first().click();
  await page.getByRole('dialog', { name: 'Use a price I enter' }).getByLabel('Price of 1 BTC').fill('100000');
  await page.getByRole('button', { name: 'Use this price' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const log = page.getByRole('dialog', { name: 'Log' });
  await log.getByRole('button', { name: 'USD' }).click();
  await log.getByLabel('Amount', { exact: true }).fill('100');
  await expect(log).toContainText('That buys 0.0010 0000 BTC');
  await log.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/records');
  await page.getByRole('region', { name: 'Recent entries' }).getByRole('button').filter({ hasText: /0\.0010/ }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Price source: your price at $100,000.00 per BTC');
});
