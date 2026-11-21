import { expect, test } from '@playwright/test';
import { setUp } from './fake.ts';
import { expectNoViolations, go, openDemo } from './helpers.ts';

test('Retirement: log a purchase, see its gain, edit and remove it; Holdings shows all Bitcoin', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-retirement');
  const purchases = page.getByRole('region', { name: 'Purchases' });
  await expect(purchases).toContainText('3 purchases');
  await expect(purchases).toContainText('up $8,041.86 (+130%)');
  await expect(page.getByRole('region', { name: 'Balance', exact: true })).toContainText('Never part of tax math.');

  await purchases.getByRole('button', { name: 'Log a purchase' }).click();
  const log = page.getByRole('dialog', { name: 'Log' });
  await expect(log.getByRole('heading', { name: 'Log a retirement purchase' })).toBeVisible();
  await expect(log.getByRole('tab')).toHaveCount(0);
  await log.getByLabel('Amount', { exact: true }).fill('0.01');
  await log.getByLabel('Total paid, including fees').fill('500');
  await expectNoViolations(page);
  await log.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(purchases).toContainText('4 purchases');
  const row = purchases.getByRole('button').filter({ hasText: 'Bought today' });
  await expect(row).toContainText('up $448.12 (+89%)');

  // Edit through the usual entry sheet, with a reason.
  await row.click();
  const entry = page.getByRole('dialog', { name: 'Bought (retirement)' });
  await expect(entry).toContainText('No, retirement');
  await expect(entry).toContainText('$948.12');
  await expectNoViolations(page);
  await entry.getByRole('button', { name: 'Edit purchase' }).click();
  const edit = page.getByRole('dialog').last();
  await edit.getByLabel('Total paid, including fees').fill('600');
  await edit.getByRole('button', { name: 'Review change' }).click();
  await expect(edit.getByText('No tax', { exact: true })).toBeVisible();
  await edit.getByLabel('Why are you changing it?').fill('Fee was higher');
  await edit.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toContainText('up $348.12 (+58%)');

  // Remove it again.
  await row.click();
  await page.getByRole('dialog', { name: 'Bought (retirement)' }).getByRole('button', { name: 'Remove this purchase' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove this purchase?' });
  await remove.getByLabel('Why are you removing it?').fill('Test entry');
  await remove.getByRole('button', { name: 'Remove purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(purchases).toContainText('3 purchases');

  // Holdings: the taxable hero is unchanged; the overall card adds retirement.
  await go(page, '/');
  const all = page.getByRole('region', { name: 'All your Bitcoin' });
  await expect(all).toContainText('Taxable');
  await expect(all).toContainText('Counts for tax');
  await expect(all).toContainText('All Bitcoin');
  await expect(all).toContainText('$33,184');
  await expect(page.getByRole('region', { name: 'Held apart from your total' })).toContainText('up $17,274');
  await expectNoViolations(page);
});

test('Retirement: a spreadsheet row for a retirement wallet becomes a retirement purchase', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const add = page.getByRole('dialog', { name: 'Add a wallet' });
  await add.getByLabel('Name').fill('My IRA');
  await add.getByRole('radio', { name: 'Retirement' }).click();
  await add.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Import and/ }).click();
  const csv = ['wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin', 'Strike,2023-01-20 14:02:11,0.01,1000000,230.00,,Documented,Email receipt', 'my ira,2023-02-01 10:00:00,0.02,2000000,400.00,,,Statement'].join('\n');
  await page.getByLabel('Choose a spreadsheet (CSV)').setInputFiles({ name: 'mixed.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const status = page.getByRole('status').filter({ hasText: 'mixed.csv' });
  await expect(status).toContainText('1 retirement purchase will be added');
  await expect(status).toContainText('Kept apart from tax math.');
  await expectNoViolations(page);
  await status.getByRole('button', { name: 'Create wallet and add 1 coin and 1 retirement purchase' }).click();
  await expect(page.getByText('Added 1 coin, 1 retirement purchase and 1 wallet.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'All your Bitcoin' })).toContainText('Retirement');
});

test('Retirement: a new wallet in the spreadsheet written as retirement purchases is asked about, then made as Retirement', async ({ page }) => {
  await setUp(page);
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Import and/ }).click();
  const csv = ['wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin', 'Coinbase,2023-01-20 14:02:11,0.01,1000000,230.00,,Documented,Email receipt', 'Swan IRA,2023-02-01 10:00:00,0.02,2000000,400.00,,,Statement'].join('\n');
  await page.getByLabel('Choose a spreadsheet (CSV)').setInputFiles({ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const status = page.getByRole('status').filter({ hasText: 'history.csv' });
  await expect(status).toContainText('Is it a retirement account?');
  await expect(status.getByRole('button', { name: /^Create/ })).toHaveCount(0);
  await status.getByRole('radiogroup', { name: 'What kind of wallet is Swan IRA' }).getByRole('radio', { name: /Retirement/ }).click();
  await expect(status).toContainText('1 retirement purchase will be added');
  await status.getByRole('button', { name: /^Create wallets and add/ }).click();
  await expect(page.getByText(/Added 1 coin, 1 retirement purchase and 2 wallets/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'All your Bitcoin' })).toContainText('Retirement');
});
