import { expect, test } from '@playwright/test';
import { setUp } from './fake.ts';
import { expectNoViolations, go, openDemo } from './helpers.ts';

const FIXTURE = new URL('./fixtures/opening-lots-one-bad-row.csv', import.meta.url).pathname;

test('Records: entries with filters and history', async ({ page }) => {
  await openDemo(page);
  await go(page, '/records');
  await expect(page.getByRole('region', { name: 'Recent entries' })).toBeVisible();
  await expectNoViolations(page);
  await go(page, '/records?v=entries');
  await page.getByLabel('Kind').selectOption('gave');
  await expect(page.getByRole('status').filter({ hasText: 'of' })).toBeVisible();
  await page.getByRole('button', { name: /Gave/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Gave' });
  await expect(dialog).toContainText('History');
  await expectNoViolations(page);
});

const NEW_WALLETS = new URL('./fixtures/opening-lots-new-wallets.csv', import.meta.url).pathname;

test('Records: import creates the new wallets, then adds the coins', async ({ page }) => {
  await setUp(page);
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Wallets/ }).click();
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name').fill('Strike');
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Import and/ }).click();
  await page.getByLabel('Choose your spreadsheet').setInputFiles(NEW_WALLETS);
  const status = page.getByRole('status').filter({ hasText: 'will be created' });
  await expect(status).toContainText('2 wallets will be created');
  const made = page.getByRole('list', { name: 'New wallets' });
  await expect(made).toContainText('Cold storage (multisig)');
  await expect(made).toContainText('2 lots');
  await expect(made).toContainText('River');
  await expect(page.getByRole('radio', { name: 'Self-custody', checked: true })).toHaveCount(1);
  await expect(status).toContainText('“strike” in the file is your wallet Strike.');
  await expect(status).toContainText('5 lots · 0.7750 BTC · $16,225 cost');
  await expect(status).toContainText('Documented');
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Create wallets and add 5 lots' }).click();
  await expect(page.getByText('Added 5 lots and 2 wallets.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await expect(page.getByText('Cold storage (multisig)').first()).toBeVisible();
});

test('Records: import opening lots with one bad row (a real book; the demo has no import)', async ({ page }) => {
  await setUp(page);
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Wallets/ }).click();
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name').fill('Strike');
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Import and/ }).click();
  await page.getByLabel('Choose your spreadsheet').setInputFiles(FIXTURE);
  const problems = page.getByRole('list', { name: 'Problems' });
  await expect(problems).toContainText('Row 4');
  await expect(problems).toContainText('sats "abc"');
  await expectNoViolations(page);
  await page.getByRole('button', { name: /Create wallet and add the 3 lots/ }).click();
  await expect(page.getByText('Added 3 lots and 1 wallet.')).toBeVisible();
});

test('Records: the demo has no import or restore, and says so', async ({ page }) => {
  await openDemo(page);
  await go(page, '/records?v=io');
  await expect(page.getByText('Not in the demo.')).toHaveCount(2);
  await expect(page.getByLabel('Choose your spreadsheet')).toHaveCount(0);
  await expect(page.getByLabel('Choose a backup file')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((k) => !['bb.hide', 'bb.kit-first-seen'].includes(k)))).toEqual([]);
});

test('Records: changing settings changes the Sell tax', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if');
  const oldest = page.getByRole('radio', { name: 'Oldest first' });
  await expect(oldest).toContainText('Tax this adds');
  const before = await oldest.innerText();
  await go(page, '/settings');
  const losses = page.getByRole('group', { name: 'Losses from past years' });
  await expect(losses.getByLabel('Long-term')).toBeVisible();
  await expect(losses).toContainText('for 2026');
  await expectNoViolations(page);
  await losses.getByLabel('Long-term').fill('0');
  await page.getByLabel('Wages and other income (a year)').fill('300000');
  await page.getByLabel('Wages and other income (a year)').blur();
  await expect(page.getByText('Saved.')).toBeVisible();
  await go(page, '/what-if');
  await expect(oldest).toContainText('Tax this adds');
  expect(await oldest.innerText()).not.toBe(before);
  await expect(oldest).not.toContainText('Tax this adds$0.00'.replace('$', '\n$'));
});

test('Records: test the emergency kit sheet, then the reminder hides', async ({ page }) => {
  // The reminder only shows 30 days after first use, so pretend the app was first opened long ago.
  await page.addInitScript(() => window.localStorage.setItem('bb.kit-first-seen', '2026-01-01'));
  await openDemo(page);
  await go(page, '/records');
  await page.getByRole('region', { name: 'Needs attention' }).getByRole('button', { name: 'Test' }).click();
  const dialog = page.getByRole('dialog', { name: 'Test your emergency kit' });
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expectNoViolations(page);
  await dialog.getByRole('button', { name: "I can't find my code" }).click();
  await expect(dialog).toContainText('the old code stops working');
  await expectNoViolations(page);
  await dialog.getByRole('button', { name: 'It worked' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Needs attention' })).toHaveCount(0);
});

test('Records: quick settings changes save once, and the entries list keeps settings out of the way', async ({ page }) => {
  await openDemo(page);
  await go(page, '/settings');
  const filing = page.getByLabel('Filing status');
  await expect(filing).toBeVisible();
  // Three choices in quick succession are one save; a pair that cancels out saves nothing.
  for (const label of ['Single', 'Head of household', 'Married filing separately']) await filing.selectOption({ label });
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 8000 });
  await expect(filing).toHaveValue('married-separate');
  await filing.selectOption({ label: 'Single' });
  await filing.selectOption({ label: 'Married filing separately' });
  await page.waitForTimeout(2500);
  await go(page, '/records?v=entries');
  await expect(page.getByText('Settings changed')).toHaveCount(0);
  await page.getByLabel('Kind').selectOption({ label: 'Settings' });
  const rows = page.getByRole('list').getByRole('button', { name: /Settings changed/ });
  await expect(rows.first()).toBeVisible();
  const text = (await rows.allInnerTexts()).join(' ');
  // One entry for the first save and none for the cancelled pair: at most one more than the demo's own.
  expect(text).not.toMatch(/×[4-9]/);
  await expectNoViolations(page);
});

test('Records: choosing the same spreadsheet again adds nothing twice', async ({ page }) => {
  await setUp(page);
  const importFile = async () => {
    await page.getByRole('link', { name: 'Records', exact: true }).click();
    await page.getByRole('link', { name: /^Import and/ }).click();
    await page.getByLabel('Choose your spreadsheet').setInputFiles(NEW_WALLETS);
  };
  await importFile();
  await page.getByRole('button', { name: 'Create wallets and add 5 lots' }).click();
  await expect(page.getByText('Added 5 lots and 3 wallets.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await importFile();
  await expect(page.getByRole('status').filter({ hasText: 'opening-lots-new-wallets.csv' })).toContainText('Everything in this file is already in your records. Nothing was added.');
  await expect(page.getByRole('button', { name: /^Add|^Create/ })).toHaveCount(0);
});

test('Entries: an aligned table on a wide card, compact rows on a phone; each row reads in full and opens the entry', async ({ page }, info) => {
  await openDemo(page);
  await go(page, '/records?v=entries');
  const list = page.getByRole('list', { name: 'Entries, newest first' });
  const first = list.getByRole('button').first();
  // Title first, then wallet and date with its year (Chrome puts a space before a comma that follows a block), the full 8-decimal BTC and what the dollars were.
  await expect(first).toHaveAccessibleName(/^Bought ?, Strike · Nov 1 ?, 2026 ?, \+0\.0324 8000 BTC ?, \$2,403\.37 paid$/);
  const heading = page.locator('[aria-hidden="true"]', { hasText: /^DateWhatWalletBitcoinDollars$/ });
  if (info.project.name === 'desktop') {
    await expect(heading).toBeVisible();
    // Every row's Bitcoin ends at the same x: the columns line up.
    const rights = await list.getByRole('button').evaluateAll((bs) =>
      bs.slice(0, 8).map((b) => {
        const cell = [...b.querySelectorAll('span')].find((s) => s.className.includes('@min-[34rem]:col-start-5'));
        return Math.round(cell?.getBoundingClientRect().right ?? -1);
      }),
    );
    expect(new Set(rights).size).toBe(1);
  } else {
    await expect(heading).toBeHidden();
  }
  // A move: both wallets, its fee, no dollars.
  await page.getByRole('searchbox', { name: 'Search entries' }).fill('moved');
  await expect(list.getByRole('button').first()).toHaveAccessibleName(/^Moved ?, Strike .*Cold storage · Jul 1 ?, 2025 ?, .*0\.2000 0000 BTC ?, fee 0\.0000 4400 BTC/);
  await list.getByRole('button').first().click();
  await expect(page.getByRole('dialog', { name: 'Moved' })).toContainText('History');
  await expectNoViolations(page);
});

test("Entries on a wallet's page: a move out shows what left (coins and fee); Hide amounts hides every figure", async ({ page }, info) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  const entries = page.getByRole('region', { name: 'Entries' });
  await entries.getByRole('button', { name: /^Show all \d+ entries/ }).click();
  const move = entries.getByRole('button', { name: /^Moved to Cold storage/ }).first();
  await expect(move).toHaveAccessibleName(/0\.2000 0000 BTC arrived · fee 0\.0000 4400 BTC · Jul 1 ?, 2025 ?, −0\.2000 4400 BTC/);
  if (info.project.name === 'desktop') await expect(page.locator('[aria-hidden="true"]', { hasText: /^DateWhatBitcoinDollars$/ })).toBeVisible();
  await expectNoViolations(page);
  // Hide amounts hides every figure in the rows; the dates stay.
  await page.getByRole('button', { name: 'Hide amounts' }).first().click();
  const texts = await entries.getByRole('listitem').allInnerTexts();
  expect(texts.length).toBeGreaterThan(20);
  for (const t of texts) expect(t.replace(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}|\b20\d\d\b/g, '')).not.toMatch(/\d/);
});
