import { expect, test, type Locator, type Page } from '@playwright/test';
import { go, openDemo } from './helpers.ts';

/**
 * Things that should never jump. Every layout shift is counted, including the ones right after a tap (the browser's
 * CLS leaves those out, but a Save button sliding under your thumb is exactly what we do not want).
 */
async function watchShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __shift: number };
    w.__shift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__shift += (e as unknown as { value: number }).value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

/** Total layout shift while `act` runs (and the page settles after it). */
async function shiftDuring(page: Page, act: () => Promise<void>): Promise<number> {
  const start = await page.evaluate(() => (window as unknown as { __shift: number }).__shift);
  await act();
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => (window as unknown as { __shift: number }).__shift);
  return end - start;
}

const top = async (l: Locator): Promise<number> => Math.round((await l.boundingBox())?.y ?? -1);

// A tiny horizontal nudge of a right-aligned figure is fine; anything that moves rows is not.
const NEAR_ZERO = 0.005;

test.beforeEach(async ({ page }) => {
  await watchShifts(page);
  await openDemo(page);
});

test('Holdings: hiding amounts and changing the unit move nothing', async ({ page }) => {
  const chart = page.getByRole('region', { name: 'Average cost versus price' }).or(page.getByRole('region', { name: 'Price over time' })).first();
  const before = await top(page.getByRole('region', { name: 'Wallets' }).first());
  expect(await shiftDuring(page, () => page.getByRole('button', { name: 'Hide amounts' }).first().click())).toBeLessThan(NEAR_ZERO);
  expect(await shiftDuring(page, () => page.getByRole('button', { name: /^Show amounts/ }).first().click())).toBeLessThan(NEAR_ZERO);
  for (let i = 0; i < 3; i++) {
    expect(await shiftDuring(page, () => page.getByRole('button', { name: /Tap to change/ }).first().click())).toBeLessThan(NEAR_ZERO);
  }
  expect(await top(page.getByRole('region', { name: 'Wallets' }).first())).toBe(before);
  await expect(chart).toBeVisible();
});

test('Log sheet: switching kinds keeps the sheet and its Save button still', async ({ page }) => {
  await page.getByRole('button', { name: 'Log something' }).or(page.getByRole('button', { name: 'Log', exact: true })).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  const sheetTop = await top(dialog);
  for (const tab of ['Received', 'Moved', 'Sold or spent', 'Gave', 'Bought']) {
    expect(await shiftDuring(page, () => dialog.getByRole('tab', { name: tab }).click())).toBeLessThan(NEAR_ZERO);
    expect(await top(dialog)).toBe(sheetTop);
  }
});

test('Log sheet: fixing an error while typing does not pull the form up', async ({ page }) => {
  await page.getByRole('button', { name: 'Log something' }).or(page.getByRole('button', { name: 'Log', exact: true })).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await dialog.getByRole('button', { name: 'Save purchase' }).click();
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  await page.waitForTimeout(500); // the errors themselves may move things once; that is the answer to the tap
  const wallet = dialog.getByLabel('Wallet', { exact: true });
  const at = await top(wallet);
  expect(await shiftDuring(page, () => dialog.getByLabel('Amount', { exact: true }).fill('0.01'))).toBeLessThan(NEAR_ZERO);
  expect(await shiftDuring(page, () => dialog.getByLabel('Total paid, including fees').fill('750'))).toBeLessThan(NEAR_ZERO);
  expect(await top(wallet)).toBe(at);
});

test('A toast never pushes the page, and opening a sheet does not slide it', async ({ page }) => {
  await go(page, '/wallet/wallet-strike');
  const coins = page.getByRole('region', { name: 'Coins in this wallet' });
  await expect(coins).toBeVisible();
  const at = await top(coins);
  expect(await shiftDuring(page, () => page.getByRole('button', { name: 'Yes', exact: true }).click())).toBeLessThan(NEAR_ZERO);
  await expect(page.getByText('Confirmed. Strike matches.')).toBeVisible();
  expect(await top(coins)).toBe(at);
  const entries = page.getByRole('region', { name: 'Entries' });
  const x = Math.round((await entries.boundingBox())?.x ?? -1);
  await entries.getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(Math.round((await entries.boundingBox())?.x ?? -2)).toBe(x);
  await page.keyboard.press('Escape');
});
