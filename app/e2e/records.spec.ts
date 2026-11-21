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
  await page.getByLabel('Choose a spreadsheet (CSV)').setInputFiles(FIXTURE);
  const problems = page.getByRole('list', { name: 'Problems' });
  await expect(problems).toContainText('Row 3');
  await expect(problems).toContainText('no wallet named "Nowhere"');
  await expectNoViolations(page);
  await page.getByRole('button', { name: /Add the 2 good rows only/ }).click();
  await expect(page.getByText('Added 2 lots.')).toBeVisible();
});

test('Records: the demo has no import or restore, and says so', async ({ page }) => {
  await openDemo(page);
  await go(page, '/records?v=io');
  await expect(page.getByText('Not in the demo.')).toHaveCount(2);
  await expect(page.getByLabel('Choose a spreadsheet (CSV)')).toHaveCount(0);
  await expect(page.getByLabel('Choose a backup file')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((k) => !['bb.hide', 'bb.kit-first-seen'].includes(k)))).toEqual([]);
});

test('Records: giving off by default, then mark paid', async ({ page }) => {
  await openDemo(page);
  await go(page, '/records?v=giving');
  await expect(page.getByText('Giving is off')).toBeVisible();
  await page.getByRole('button', { name: 'Turn it on' }).click();
  await expect(page.getByRole('region', { name: 'What is due' })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(page.getByRole('list', { name: 'Payments' })).toContainText('Paid for 2026');
  await expect(page.getByRole('region', { name: 'What is due' })).toContainText('$0.00');
});

test('Records: changing settings changes the Sell tax', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if');
  const oldest = page.getByRole('radio', { name: 'Oldest first' });
  await expect(oldest).toContainText('Tax this adds');
  const before = await oldest.innerText();
  await go(page, '/records?v=settings');
  await expect(page.getByLabel('Long-term loss carried in')).toBeVisible();
  await expectNoViolations(page);
  await page.getByLabel('Long-term loss carried in').fill('0');
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
