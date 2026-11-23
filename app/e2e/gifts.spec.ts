import { expect, test, type Page } from '@playwright/test';
import { expectNoViolations, go, openDemo } from './helpers.ts';

// Gifts: lowest-cost lots by default, and "I bought it to give" (a purchase and the gift of it, saved together).
// Demo book: Cold storage's oldest lots are from early 2022 ($40,000 a BTC then); its lowest-cost lot (about $17,000
// per BTC) is from Nov 13, 2022, after the price fell.

async function openGave(page: Page) {
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Log' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('tab', { name: 'Gave' }).click();
  return page.getByRole('dialog').last();
}

test('a gift uses the lowest-cost lots first, says why, and the note shows them', async ({ page }) => {
  await openDemo(page);
  const d = await openGave(page);
  await expect(d.getByRole('radio', { name: 'Lowest cost first' })).toHaveAttribute('aria-checked', 'true');
  await expect(d.getByText('Uses your lowest-cost lots first, so you keep your higher-cost Bitcoin (less tax when you sell later). The person you give to takes on your cost.')).toBeVisible();
  await d.getByLabel('Amount', { exact: true }).fill('0.01');
  await d.getByLabel('From wallet').selectOption({ label: 'Cold storage' });
  await d.getByLabel('Who is it for?').fill('Mom');
  await expect(d.getByText('Uses 1 lot, lowest cost first. Saved with the entry.')).toBeVisible();
  const lots = d.getByRole('list', { name: 'Lots in this wallet' });
  await expect(lots.getByRole('listitem').first()).toContainText('Nov 13, 2022');
  await expect(d.getByText('Nobody can claim the loss')).toHaveCount(0);
  await expectNoViolations(page);

  await d.getByRole('button', { name: 'Review gift' }).click();
  const used = d.getByRole('region', { name: 'Lots used' });
  await expect(used).toContainText('Nov 13, 2022');
  await expect(used).toContainText('(1)');
  await expectNoViolations(page);
  await d.getByRole('button', { name: 'Save gift' }).click();
  await expect(d.getByText('Gift saved')).toBeVisible();
  await expect(d.getByRole('list', { name: 'Lots given' })).toContainText('Bought Nov 13, 2022');
});

test('Pick lots is still there for a gift', async ({ page }) => {
  await openDemo(page);
  const d = await openGave(page);
  await d.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await d.getByLabel('Amount', { exact: true }).fill('0.01');
  await d.getByRole('radio', { name: 'Pick lots' }).click();
  await expect(d.getByRole('checkbox', { checked: true })).toHaveCount(2);
});

test('"I bought it to give" logs the purchase and the gift together; the gift uses that purchase', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  await expect(page.getByRole('heading', { name: 'Strike', level: 1 })).toBeVisible();
  await expect(page.getByText('0.4200 0000 BTC').first()).toBeVisible();
  const d = await openGave(page);
  // By keyboard: the switch keeps focus while the form below changes.
  const sw = d.getByRole('switch', { name: 'I bought it to give' });
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(sw).toBeChecked();
  await expect(sw).toBeFocused();
  await d.getByLabel('Amount bought').fill('0.00052734');
  await d.getByLabel('Bought in').selectOption({ label: 'Strike' });
  await d.getByLabel('Total paid, including fees').fill('50');
  await d.getByLabel('Who is it for?').fill('Mom');
  await expect(d.getByText('Gives all of it, 0.0005 2734 BTC, worth $50.00 (what you paid), right after the purchase.')).toBeVisible();
  await expectNoViolations(page);

  await d.getByRole('button', { name: 'Review purchase and gift' }).click();
  await expect(page.getByRole('heading', { name: 'Review purchase and gift' })).toBeVisible();
  const purchase = d.getByRole('region', { name: 'Purchase' });
  await expect(purchase).toContainText('0.0005 2734 BTC');
  await expect(purchase).toContainText('$50.00');
  await expect(purchase).toContainText('Strike');
  const gift = d.getByRole('region', { name: 'Gift', exact: true });
  await expect(gift).toContainText('Mom');
  await expect(gift).toContainText('Right after the purchase');
  // The gift uses only the new lot, bought today.
  const used = d.getByRole('region', { name: 'Lots used' });
  await expect(used).toContainText('(1)');
  await expect(used).toContainText('Nov 20, 2026');
  await expect(d.getByRole('region', { name: 'Gift note' })).toContainText('$50.00');
  await expectNoViolations(page);
  await d.getByRole('button', { name: 'Save purchase and gift' }).click();
  await expect(d.getByText('Gift saved')).toBeVisible();
  await expect(d.getByRole('list', { name: 'Lots given' })).toContainText('Bought Nov 20, 2026');
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The wallet is where it was: bought and given away. Newest first: the gift, then the purchase.
  await expect(page.getByText('0.4200 0000 BTC').first()).toBeVisible();
  const entries = page.getByRole('region', { name: 'Entries' });
  const rows = entries.getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Gave to Mom');
  await expect(rows.nth(0)).toContainText('Strike · Nov 20, 2026');
  await expect(rows.nth(1)).toContainText('Bought');
  await expect(rows.nth(1)).toContainText('Strike · Nov 20, 2026');

  // Tax season counts the gift, at its value and the giver's cost.
  await go(page, '/tax');
  await expect(page.getByRole('region', { name: 'Gifts given' })).toContainText('2 · none over $19,000 to one person');
  await expectNoViolations(page);

  // Each entry can still be removed on its own: the gift first (removing the purchase first would break it).
  await go(page, '/records');
  await page.getByRole('region', { name: 'Recent entries' }).getByRole('button', { name: /^Gave to Mom/ }).first().click();
  await page.getByRole('button', { name: 'Remove this gift' }).click();
  const remove = page.getByRole('dialog').last();
  await remove.getByLabel('Why are you removing it?').fill('Test');
  await remove.getByRole('button', { name: 'Remove gift' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
