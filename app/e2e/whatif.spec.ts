import { expect, test, type Locator } from '@playwright/test';
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

/** `+$3,214.69` or `−$1,400.00` as cents. */
const cents = (text: string): number => (text.startsWith('\u2212') ? -1 : 1) * Number(text.replace(/[^\d]/g, ''));

async function figure(card: Locator, label: RegExp): Promise<number> {
  const m = new RegExp(`${label.source}\\n([+\u2212]?\\$[\\d,.]+)`).exec(await card.innerText());
  if (m?.[1] === undefined) throw new Error(`no ${label.source} in the card`);
  return cents(m[1]);
}

test('Sell: plan cards line up row by row, and the lots used add up to the card', async ({ page, isMobile }) => {
  await openDemo(page);
  await go(page, '/what-if');
  const choice = page.getByRole('radiogroup', { name: 'Which lots to sell' });
  const oldest = choice.getByRole('radio', { name: 'Oldest first' });
  const lowest = choice.getByRole('radio', { name: 'Lowest tax' });
  await expect(lowest).toHaveAttribute('aria-checked', 'true');
  // The same rows in the same places on every card.
  for (const label of [/^Tax this (adds|saves)$/, /^You keep after tax$/, /^Short-term (gain|loss)$/, /^Long-term (gain|loss)$/, /^Losses left for next year$/, /^On Estimated or Unknown cost$/, /^Lots used$/]) {
    const a = await oldest.getByText(label).boundingBox();
    const b = await lowest.getByText(label).boundingBox();
    expect(a && b && Math.abs(a.y - b.y)).toBeLessThan(1);
  }
  // The demo's two plans add no tax; lowest tax leaves more losses for next year, so the engine prefers it.
  await expect(lowest).toContainText('Keeps more losses');
  await expect(oldest).not.toContainText(/Least tax|Saves the most|Keeps more losses/);
  for (const card of [oldest, lowest]) {
    const tax = await figure(card, /Tax this (?:adds|saves)/);
    const text = await card.innerText();
    const fs = /Federal (\$[\d,.]+) [+\u2212] state (\$[\d,.]+)/.exec(text);
    expect(fs && cents(fs[1] ?? '') + cents(fs[2] ?? '')).toBe(tax);
    const keep = await figure(card, /You keep after tax/);
    const sale = /(\$[\d,.]+) sale [\u2212+] (\$[\d,.]+) tax/.exec(text);
    expect(sale && cents(sale[1] ?? '') - cents(sale[2] ?? '')).toBe(keep);
  }

  const lots = page.getByRole('region', { name: 'Lots used' });
  const toggle = lots.getByRole('button', { name: /^Lots used in Lowest tax/ });
  await expect(toggle).toContainText('11 lots');
  // 11 lots: folded to start.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const rows = lots.getByRole('list', { name: 'Lots used in Lowest tax' }).getByRole('listitem');
  await expect(rows).toHaveCount(11);
  await expect(rows.first()).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  const total = lots.getByRole('group', { name: 'Total of the lots used' });
  const totalGain = /([+\u2212]?\$[\d,.]+)$/.exec((await total.innerText()).trim());
  expect(cents(totalGain?.[1] ?? '')).toBe((await figure(lowest, /Short-term (?:gain|loss)/)) + (await figure(lowest, /Long-term (?:gain|loss)/)));
  await expectNoViolations(page);

  // The table follows the choice.
  await oldest.click();
  await expect(oldest).toHaveAttribute('aria-checked', 'true');
  await expect(lots.getByRole('button', { name: /^Lots used in Oldest first/ })).toContainText('13 lots');

  // Hide amounts hides every figure on the cards and in the table (dates and counts stay).
  await page.getByRole('button', { name: 'Hide amounts', exact: true }).first().click();
  await expect(oldest).not.toContainText(/\$\d|\d%/);
  await expect(lowest).not.toContainText(/\$\d|\d%/);
  await expect(lots).not.toContainText(/\$\d|\d\.\d{4}/);
  await page.getByRole('button', { name: 'Show amounts', exact: true }).first().click();

  // A third plan after picking lots: full width under the two on a phone, a third column on desktop.
  await page.getByRole('button', { name: 'Pick lots' }).click();
  await page.getByRole('dialog', { name: 'Pick lots' }).getByRole('button', { name: 'Use these lots' }).click();
  const picked = choice.getByRole('radio', { name: 'Lots you picked' });
  await expect(picked).toHaveAttribute('aria-checked', 'true');
  const [g, o, h] = [await choice.boundingBox(), await oldest.boundingBox(), await picked.boundingBox()];
  if (!g || !o || !h) throw new Error('no boxes');
  if (isMobile) {
    expect(Math.abs(h.width - g.width)).toBeLessThan(1);
    expect(h.y).toBeGreaterThan(o.y + o.height);
  } else {
    expect(Math.abs(h.y - o.y)).toBeLessThan(1);
    expect(Math.abs(h.width - o.width)).toBeLessThan(1);
  }
  await expectNoViolations(page);
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
  // Past the lender's limits: no "Price could fall 0%".
  await page.getByLabel('Borrow', { exact: true }).fill('80000');
  await expect(ltv).toContainText('The lender would already sell at this price');
  await expect(ltv).not.toContainText('Price could fall');
  await page.getByLabel('Borrow', { exact: true }).fill('70000');
  await expect(ltv).toContainText('Already past the margin call');
  await expect(ltv).toContainText('Price could fall');
  await page.getByLabel('Borrow', { exact: true }).fill('abc');
  await expect(page.getByRole('alert')).toContainText('dollars');
  await page.getByLabel('Borrow', { exact: true }).fill('25000');
  await page.getByRole('button', { name: 'Save this scenario' }).click();
  await expect(page.getByRole('region', { name: 'Saved scenarios' })).toBeVisible();
});
