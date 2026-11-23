import { replay } from '@bitcoin-basis/engine';
import { expect, test } from '@playwright/test';
import { buildDemoBook, DEMO_TODAY } from '../src/demo/demo-data.ts';
import { formatMoney } from '../src/lib/format.ts';
import { yearTaxView } from '../src/screens/tax/tax-logic.ts';
import { expectNoViolations, go, openDemo } from './helpers.ts';

test('Tax season: year view and 8949 download', async ({ page }) => {
  await openDemo(page);
  await go(page, '/tax');
  await expect(page.getByRole('region', { name: 'Digital asset question' })).toContainText('Answer: Yes');
  await expect(page.getByRole('region', { name: 'Tax forms from exchanges' })).toContainText('Exchanges send a 1099-DA listing your sales');
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

test('Tax season: the year’s result shows exactly the engine’s netting, in words', async ({ page }) => {
  const state = replay(buildDemoBook().entries);
  const v = yearTaxView(state, state.settings, 2026, DEMO_TODAY);
  const carried = v.carriedIn.st + v.carriedIn.lt;
  // The math under the big number adds up to it.
  expect(v.stCents + v.ltCents - carried).toBe(v.netting.net);
  await openDemo(page);
  await go(page, '/tax');
  const result = page.getByRole('region', { name: 'Your 2026 result' });
  await expect(result).toContainText(formatMoney(v.netting.net, { signed: true }));
  await expect(result).toContainText(`This year ${formatMoney(v.stCents + v.ltCents, { signed: true })} − losses from past years ${formatMoney(carried)}`);
  await expect(result).toContainText('No tax on Bitcoin gains for 2026');
  await expect(result).toContainText(`${formatMoney(v.netting.lossDeduction)} lowers your other income. ${formatMoney(v.carryOut.st + v.carryOut.lt)} carries into 2027.`);
  await expect(result).toContainText(`Losses left for 2027${formatMoney(v.carryOut.st + v.carryOut.lt)}`);
  await expect(result.getByRole('list', { name: 'What happened in 2026' })).toContainText('1 purchase paid in Bitcoin');
  await result.getByRole('button', { name: 'How it nets out, for Schedule D' }).click();
  const netted = result.getByRole('region', { name: 'After losses from past years' });
  await expect(netted).toContainText(`Short-term after past losses${formatMoney(v.netting.st, { signed: true })}`);
  await expect(netted).toContainText(`Long-term after past losses${formatMoney(v.netting.lt, { signed: true })}`);
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Hide amounts' }).first().click();
  expect(await result.innerText()).not.toMatch(/\$\d/);
});
