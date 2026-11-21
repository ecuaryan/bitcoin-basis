import { loanSummary, replay } from '@bitcoin-basis/engine';
import { expect, test, type Page } from '@playwright/test';
import { buildDemoBook, DEMO_LOAN_ID, DEMO_PRICE_CENTS, DEMO_TODAY } from '../src/demo/demo-data.ts';
import { formatMoney, groupedBtc, shortBtc } from '../src/lib/format.ts';
import { setUp } from './fake.ts';
import { expectNoViolations, go, openDemo } from './helpers.ts';

/** The demo loan as the engine sees it on the demo's day at the demo's price: what Holdings must show. */
const expected = (() => {
  const s = loanSummary(replay(buildDemoBook().entries), DEMO_LOAN_ID, DEMO_PRICE_CENTS, DEMO_TODAY);
  if (s === null) throw new Error('the demo has no loan');
  return s;
})();
const dollars = (c: number) => formatMoney(c, { precision: 'dollars' });

async function openLog(page: Page) {
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Holdings: the loan card shows exactly the engine’s figures for the demo loan', async ({ page }) => {
  await openDemo(page);
  const card = page.getByRole('region', { name: 'Loans' });
  await expect(card).toContainText('Home equity line');
  await expect(card).toContainText(`Owed ${dollars(expected.principalOwedCents)} · Available ${dollars(expected.availableCreditCents ?? 0)}`);
  await expect(card).toContainText(`Bought ${shortBtc(expected.heldSats)} BTC · worth ${dollars(expected.valueCents ?? 0)}`);
  await expect(card).toContainText(`Interest paid ${dollars(expected.interestPaidCents)}`);
  await expect(card).toContainText(formatMoney(expected.gainIncludingInterestCents ?? 0, { precision: 'dollars', signed: true }));
  await expect(card).toContainText(`Break-even price (with interest paid so far) ${dollars(expected.breakEvenPriceCents ?? 0)}`);
  const left = expected.payoffLeftoverSats ?? 0;
  await expect(card).toContainText(`${shortBtc(Math.abs(left))} BTC ${left < 0 ? 'short' : 'left over'}`);
  await expect(page.getByRole('region', { name: 'Loan payment reminder' })).toHaveCount(0);
  await expectNoViolations(page);
  await card.getByRole('link', { name: /Home equity line/ }).click();
  await expect(page.getByRole('heading', { name: 'Home equity line', level: 1 })).toBeVisible();
  const standing = page.getByRole('region', { name: 'Where it stands' });
  await expect(standing).toContainText(formatMoney(expected.principalOwedCents));
  await expect(standing).toContainText(formatMoney(expected.owedNowCents));
  await expect(standing).toContainText('(variable)');
  await expect(page.getByRole('region', { name: 'Purchases' })).toContainText('4 purchases');
  await expect(page.getByRole('region', { name: 'Statement check' })).toContainText(`Matched Oct 31`);
  await expectNoViolations(page);
});

test('Hide amounts masks every loan figure in one fixed shape', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Hide amounts' }).first().click();
  const card = page.getByRole('region', { name: 'Loans' });
  await expect(card).toContainText('$•••••');
  expect(await card.innerText()).not.toMatch(/\$\d|\d\.\d{4}/);
  await go(page, `/loans/${DEMO_LOAN_ID}`);
  const standing = page.getByRole('region', { name: 'Where it stands' });
  await expect(standing).toContainText('$•••••');
  for (const name of ['Where it stands', 'Purchases', 'Payments', 'Statement check']) {
    expect(await page.getByRole('region', { name }).innerText(), name).not.toMatch(/\$\d|\d\.\d{4}/);
  }
  await expectNoViolations(page);
});

test('Set up a loan, link purchases, log a payment, check the statement, change the rate', async ({ page }) => {
  await openDemo(page);
  await go(page, '/records?v=loans');
  await expect(page.getByRole('link', { name: /Home equity line/ })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Track a loan' }).click();
  const setup = page.getByRole('dialog', { name: 'Track a loan' });
  await setup.getByRole('button', { name: 'Next: its purchases' }).click();
  await expect(setup.getByText('Give it a name, like HELOC.')).toBeVisible();
  await setup.getByLabel('Name').fill('Margin loan');
  await setup.getByLabel('Interest rate (APR)').fill('9.5');
  await setup.getByLabel('Credit limit (optional)').fill('20000');
  await expectNoViolations(page);
  await setup.getByRole('button', { name: 'Next: its purchases' }).click();
  await expect(setup.getByText('Interest starts the day the money is drawn')).toBeVisible();
  const boxes = setup.getByRole('checkbox', { disabled: false });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(setup.getByRole('status')).toContainText('2 purchases chosen');
  await expectNoViolations(page);
  await setup.getByRole('button', { name: 'Save loan' }).click();
  await expect(page.getByRole('heading', { name: 'Margin loan', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Purchases' })).toContainText('2 purchases');

  // A payment: interest part and the rest, which lowers what is owed.
  await page.getByRole('button', { name: 'Log a payment' }).click();
  const pay = page.getByRole('dialog', { name: 'Log a payment' });
  await expect(pay.getByLabel('Interest part')).toBeVisible();
  await expectNoViolations(page);
  await pay.getByLabel('Amount paid').fill('100');
  await pay.getByLabel('Interest part').fill('20');
  await expect(pay.getByLabel('After this payment')).toContainText('$80.00');
  await pay.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText('Payment saved.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Payments' })).toContainText('1 payment');

  // The statement: a difference, then a match.
  const check = page.getByRole('region', { name: 'Statement check' });
  const owed = Number((await check.locator('strong').first().innerText()).replace(/[$,.]/g, ''));
  await check.getByRole('button', { name: 'No, it’s different' }).or(check.getByRole('button', { name: "No, it's different" })).click();
  await check.getByLabel('What it shows').fill(formatMoney(owed + 50_000).replace('$', ''));
  await check.getByRole('button', { name: 'Check' }).click();
  await expect(check.getByRole('status').filter({ hasText: 'Your statement shows' })).toContainText('$500.00 more');
  await expectNoViolations(page);
  await check.getByRole('button', { name: /Add a draw of \$500\.00/ }).click();
  await expect(page.getByText('Draw added. It matches now.')).toBeVisible();
  await page.getByRole('region', { name: 'Statement check' }).getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.getByText('Matches your statement.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Statement check' })).toContainText(/Matched (Nov \d+|today)/);

  // The rate changed.
  await page.getByRole('button', { name: 'Rate changed' }).click();
  const rate = page.getByRole('dialog', { name: 'Rate changed' });
  await rate.getByLabel('New rate (APR)').fill('8.25');
  await expectNoViolations(page);
  await rate.getByRole('button', { name: 'Save rate' }).click();
  await expect(page.getByRole('region', { name: 'Rate' })).toContainText('8.25%');
  await expect(page.getByRole('region', { name: 'Where it stands' })).toContainText('8.25% (variable)');

  // Loan records stay out of the everyday list; Kind = Loan shows them.
  await go(page, '/records?v=entries');
  await expect(page.getByRole('region', { name: 'Entries' })).not.toContainText('Loan payment');
  await page.getByLabel('Kind').selectOption('loans');
  await expect(page.getByRole('region', { name: 'Entries' })).toContainText('Loan payment');
});

test('Bought: "Paid with" a loan saves the purchase and its link in one save, and shows the badge', async ({ page }) => {
  await openDemo(page);
  const log = await openLog(page);
  await log.getByLabel('Amount', { exact: true }).fill('0.01');
  await log.getByLabel('Total paid, including fees').fill('900');
  await log.getByLabel('Paid with').selectOption({ label: 'Home equity line' });
  await expect(log).toContainText('Counts as money drawn from Home equity line that day.');
  await log.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByText('Purchase saved.')).toBeVisible();
  await go(page, '/records');
  const recent = page.getByRole('region', { name: 'Recent entries' });
  await expect(recent.getByRole('button').first()).toContainText('HELOC');
  await go(page, `/loans/${DEMO_LOAN_ID}`);
  await expect(page.getByRole('region', { name: 'Purchases' })).toContainText('5 purchases');
});

test('Bought: "Add a loan…" returns to the purchase with the new loan chosen and saves nothing until Save purchase', async ({ page }) => {
  await openDemo(page);
  const log = await openLog(page);
  await log.getByLabel('Amount', { exact: true }).fill('0.01');
  await log.getByLabel('Total paid, including fees').fill('900');
  await log.getByLabel('When').fill('2026-10-01T10:00');
  await log.getByLabel('Paid with').selectOption({ label: 'Add a loan…' });
  const setup = page.getByRole('dialog', { name: 'Track a loan' });
  await setup.getByLabel('Name').fill('Card line');
  await setup.getByLabel('Interest rate (APR)').fill('19.99');
  await setup.getByRole('button', { name: 'Use this loan' }).click();
  await expect(setup).toHaveCount(0);

  // Back on the purchase, everything as typed, the new loan chosen, and nothing saved yet.
  await expect(log).toBeVisible();
  await expect(log.getByLabel('Paid with').locator('option:checked')).toHaveText('Card line');
  await expect(log.getByLabel('Total paid, including fees')).toHaveValue('900');
  await expect(log).toContainText('The loan is saved with this purchase.');
  await expect(page.getByText('Purchase saved.')).toHaveCount(0);
  await expectNoViolations(page);

  // One save: the purchase, the loan and the link together.
  await log.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByText('Purchase saved.')).toBeVisible();
  await expect(log).toHaveCount(0);
  await go(page, '/records?v=loans');
  await page.getByRole('link', { name: /^Card line/ }).click();
  await expect(page.getByRole('heading', { name: 'Card line', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Purchases' })).toContainText('1 purchase');
  // The loan starts on the purchase's day, not today, so its rate covers the money drawn for it.
  await expect(page.getByRole('region', { name: 'Rate' })).toContainText('From the start, Oct 1');
});

test('Bought: a loan added from the form is not saved if the purchase is not', async ({ page }) => {
  await openDemo(page);
  const log = await openLog(page);
  await log.getByLabel('Paid with').selectOption({ label: 'Add a loan…' });
  const setup = page.getByRole('dialog', { name: 'Track a loan' });
  await setup.getByLabel('Name').fill('Card line');
  await setup.getByLabel('Interest rate (APR)').fill('19.99');
  await setup.getByRole('button', { name: 'Use this loan' }).click();
  await expect(setup).toHaveCount(0);
  await expect(log.getByLabel('Paid with').locator('option:checked')).toHaveText('Card line');
  await log.getByRole('button', { name: 'Close' }).click();
  await expect(log).toHaveCount(0);
  await go(page, '/records?v=loans');
  await expect(page.getByRole('link', { name: /Home equity line/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Card line/ })).toHaveCount(0);
});

test('Loan payment sheet: typing and errors never move the Save button', async ({ page }) => {
  await openDemo(page);
  await go(page, `/loans/${DEMO_LOAN_ID}`);
  await page.getByRole('button', { name: 'Log a payment' }).click();
  const pay = page.getByRole('dialog', { name: 'Log a payment' });
  const save = pay.getByRole('button', { name: 'Save payment' });
  await expect(save).toBeVisible();
  const top = async () => Math.round((await save.boundingBox())?.y ?? -1);
  const at = await top();
  await save.click();
  await expect(pay.getByRole('alert').first()).toBeVisible();
  expect(await top()).toBe(at);
  await pay.getByLabel('Amount paid').fill('50');
  await pay.getByLabel('Interest part').fill('60');
  await save.click();
  await expect(pay.getByText('The interest part can’t be more than what you paid.')).toBeVisible();
  expect(await top()).toBe(at);
  await pay.getByLabel('Interest part').fill('10');
  expect(await top()).toBe(at);
});

test('Import: a funded_by column creates the loan in the preview and links its rows', async ({ page }) => {
  await setUp(page);
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Import and/ }).click();
  await page.getByLabel('Choose a spreadsheet (CSV)').setInputFiles(new URL('./fixtures/opening-lots-funded-by.csv', import.meta.url).pathname);
  const status = page.getByRole('status').filter({ hasText: 'will be created' });
  await expect(status).toContainText('1 loan will be created');
  await expect(status).toContainText('2 lots paid with a loan');
  const add = page.getByRole('button', { name: /add 3 lots/i });
  await expect(add).toBeDisabled();
  await page.getByLabel('Interest rate for HELOC (2 lots)').fill('8.5');
  await expectNoViolations(page);
  await add.click();
  await expect(page.getByText('Added 3 lots, 1 wallet and 1 loan.')).toBeVisible();
  const card = page.getByRole('region', { name: 'Loans' });
  await expect(card).toContainText('HELOC');
  await expect(card).toContainText('Owed $12,600');
});

test('Loan settings, removing a payment, closing and reopening', async ({ page }) => {
  await openDemo(page);
  await go(page, `/loans/${DEMO_LOAN_ID}`);
  await page.getByRole('button', { name: 'Change settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Loan settings' });
  await settings.getByLabel('Name').fill('HELOC');
  await settings.getByText('Advanced').click();
  await settings.getByRole('radio', { name: '360 days' }).click();
  await expectNoViolations(page);
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'HELOC', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Loan settings' })).toContainText('360-day year');

  // A payment opens like any entry, and can be removed with a reason.
  const payments = page.getByRole('region', { name: 'Payments' });
  await payments.getByRole('button', { name: /Nov 15/ }).click();
  const entry = page.getByRole('dialog', { name: 'Loan payment' });
  await expect(entry).toContainText('Interest part');
  await expectNoViolations(page);
  await entry.getByRole('button', { name: 'Remove this payment' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove this payment?' });
  await remove.getByLabel('Why are you removing it?').fill('Logged twice');
  await remove.getByRole('button', { name: 'Remove payment' }).click();
  await expect(payments).toContainText('14 payments');

  await page.getByRole('button', { name: 'Close this loan' }).click();
  await page.getByRole('dialog', { name: 'Close HELOC?' }).getByRole('button', { name: 'Close loan' }).click();
  await expect(page.getByText('This loan is closed.')).toBeVisible();
  await go(page, '/');
  await expect(page.getByRole('region', { name: 'Loans' })).toHaveCount(0);
  await go(page, `/loans/${DEMO_LOAN_ID}`);
  await page.getByRole('button', { name: 'Reopen this loan' }).click();
  await expect(page.getByText('This loan is closed.')).toHaveCount(0);
});

test('Loan page: Bought is everything the purchases bought; after a gift, Still held and where the rest went', async ({ page }) => {
  await openDemo(page);
  await go(page, `/loans/${DEMO_LOAN_ID}`);
  const rows = page.getByRole('region', { name: 'Where it stands' }).getByLabel('The loan');
  const row = (k: string) => rows.locator('div').filter({ has: page.getByText(k, { exact: true }) });
  // The demo's loan purchases are all still held: one row, the full amount.
  await expect(row('Bought')).toContainText(`${groupedBtc(expected.boughtSats)} BTC`);
  await expect(rows.getByText('Still held', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'What does paying it off today use?' }).click();
  await expect(rows).toContainText('not been billed yet');

  // Give away a little from a lot the loan paid for.
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const log = page.getByRole('dialog', { name: 'Log' });
  await log.getByRole('tab', { name: 'Gave' }).click();
  await log.getByLabel('Who is it for?').fill('Sam');
  await log.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await log.getByLabel('Amount', { exact: true }).fill('0.001');
  await log.getByRole('radio', { name: 'Pick lots' }).click();
  const list = log.getByRole('list', { name: 'Lots in this wallet' });
  for (const box of await list.getByRole('checkbox').all()) if (await box.isChecked()) await box.uncheck();
  await list.getByRole('listitem').filter({ hasText: 'HELOC' }).first().getByRole('checkbox').check();
  await log.getByRole('button', { name: 'Review gift' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Save gift' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(row('Bought')).toContainText(`${groupedBtc(expected.boughtSats)} BTC`);
  await expect(row('Still held')).toContainText(`${groupedBtc(expected.heldSats - 100_000)} BTC`);
  await expect(row('Still held')).toContainText('0.0010 0000 BTC later given away');
  await expectNoViolations(page);
});
