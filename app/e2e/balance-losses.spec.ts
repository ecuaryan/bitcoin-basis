import { expect, test } from '@playwright/test';
import { expectNoViolations, go, openDemo } from './helpers.ts';

test('balance check: the question is plain, the first-time help goes away, hide-amounts masks it', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-river');
  const card = page.getByRole('region', { name: 'Does it match?' });
  await expect(card).toContainText('Does River show');
  // River was confirmed in the demo, so the first-time help is not shown.
  await expect(card).not.toContainText('A quick check that nothing was missed');
  await expectNoViolations(page);
  await page.getByRole('button', { name: /Hide amounts|Hide/ }).first().click();
  await expect(card.getByRole('img', { name: 'Amount hidden. Hold to show.' })).toBeVisible();
});

test('balance check: first-time help shows until the first confirmation', async ({ page }) => {
  await openDemo(page);
  await go(page, '/records?v=wallets');
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name').fill('Ledger');
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  await page.getByRole('region', { name: 'Wallets' }).getByText('Ledger').first().click();
  const card = page.getByRole('region', { name: 'Does it match?' });
  await expect(card).toContainText("A quick check that nothing was missed. If the numbers differ, a buy or fee wasn't logged.");
  await card.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Confirmed. Ledger matches.')).toBeVisible();
  await expect(card).not.toContainText('A quick check that nothing was missed');
});

test('reminder: appears for a wallet with coins that was never checked, and Not now hides it', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByRole('region', { name: 'Balance reminder' })).toHaveCount(0);
  await go(page, '/records?v=wallets');
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name').fill('Ledger');
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const d = page.getByRole('dialog', { name: 'Log' });
  await d.getByRole('tab', { name: 'Bought' }).click();
  await d.getByLabel('Amount', { exact: true }).fill('0.01');
  await d.getByLabel('Total paid, including fees').fill('750');
  await d.getByLabel('Wallet', { exact: true }).selectOption({ label: 'Ledger' });
  await d.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  const nudge = page.getByRole('region', { name: 'Balance reminder' });
  await expect(nudge).toContainText("Check Ledger's balance");
  await expect(nudge).toContainText('Not confirmed yet');
  await expectNoViolations(page);
  await nudge.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Ledger', level: 1 })).toBeVisible();
  await go(page, '/');
  await page.getByRole('region', { name: 'Balance reminder' }).getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('region', { name: 'Balance reminder' })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('bb.nudge-until'))).toBe('2026-12-20');
});

test('losses from past years: Holdings explains them and Settings uses the new words', async ({ page }) => {
  await openDemo(page);
  const help = page.getByRole('button', { name: 'What are losses from past years?' });
  await expect(help).toBeVisible();
  await help.click();
  await expect(page.getByText(/Unused losses from earlier tax returns/)).toBeVisible();
  await expect(page.getByText(/your CPA has them \(Schedule D, capital loss carryover\)/)).toBeVisible();
  await expectNoViolations(page);
  await go(page, '/settings');
  const losses = page.getByRole('group', { name: 'Losses from past years' });
  await losses.getByRole('button', { name: 'What are losses from past years?' }).click();
  await expect(losses).toContainText("The app can't see your returns.");
  await expect(losses).toContainText('for 2026');
  await expectNoViolations(page);
  for (const path of ['/', '/what-if', '/tax', '/settings']) {
    await go(page, path);
    await expect(page.locator('body')).not.toContainText(/carry-?forward/i);
  }
});

test('year close: offers the losses left for next year and saves them', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const d = page.getByRole('dialog', { name: 'Log' });
  await d.getByRole('tab', { name: 'Sold' }).click();
  await d.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await d.getByLabel('Amount', { exact: true }).fill('0.1');
  await d.getByLabel('Dollars you received').fill('100');
  await d.getByLabel('When').fill('2025-12-15T12:00');
  await d.getByRole('button', { name: 'Review sale' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Save sale' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/tax?year=2025');
  await page.getByRole('button', { name: /Close 2025 once/ }).click();
  await page.getByRole('dialog', { name: 'Close 2025?' }).getByRole('button', { name: 'Close 2025' }).click();
  const done = page.getByRole('dialog', { name: '2025 is closed' });
  await expect(done).toContainText('Losses left for 2026');
  await expect(done).toContainText('Check against your filed return. Losses or gains outside Bitcoin (like stocks) change it.');
  await expectNoViolations(page);
  await done.getByRole('button', { name: 'Use these for 2026' }).click();
  await expect(page.getByText('Saved for 2026.')).toBeVisible();
  await go(page, '/settings');
  await expect(page.getByRole('group', { name: 'Losses from past years' })).toContainText('for 2026');
  await go(page, '/tax');
  const result = page.getByRole('region', { name: /^Your \d{4} result$/ });
  await expect(result).toContainText('after losses from past years');
  await result.getByRole('button', { name: 'How it nets out, for Schedule D' }).click();
  await expect(page.getByRole('region', { name: 'After losses from past years' })).toContainText('Losses from past years');
});
