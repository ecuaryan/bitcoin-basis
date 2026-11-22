import { expect, test } from '@playwright/test';
import { setUp } from './fake.ts';
import { expectNoViolations, go, openDemo } from './helpers.ts';

test('the gear opens Settings with its sections, and old Records links land there', async ({ page }) => {
  await openDemo(page);
  const gear = page.getByRole('link', { name: 'Settings', exact: true });
  await gear.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page).toHaveTitle('Settings · Bitcoin Basis');
  await expect(gear).toHaveAttribute('aria-current', 'page');
  const headings = await page.getByRole('heading', { level: 2 }).filter({ hasText: /^(Taxes|Security and devices|Emergency kit|App)$/ }).allTextContents();
  expect(headings).toEqual(['Taxes', 'Security and devices', 'Emergency kit', 'App']);
  await expectNoViolations(page);

  await go(page, '/records');
  await expect(page.getByRole('link', { name: /^Security/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Settings/ })).toHaveCount(1); // the gear only, no tile
  await go(page, '/records?v=security');
  await expect(page).toHaveURL(/\/settings#security$/);
});

test('the brand links to Holdings', async ({ page }) => {
  await openDemo(page);
  await go(page, '/tax');
  await page.getByRole('link', { name: 'Bitcoin Basis, go to Holdings' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('header fits three icon buttons at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openDemo(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  for (const name of ['Hide amounts', 'Settings', 'Lock']) {
    const box = await page.getByRole(name === 'Settings' ? 'link' : 'button', { name, exact: true }).first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  }
});

test('a year with no tax table shows which rates are used', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2028-06-15T12:00:00Z'));
  await setUp(page);
  await go(page, '/tax');
  await expect(page.getByText("Using 2027 tax rates; 2028 rates aren't in the app yet.")).toBeVisible();
  await expectNoViolations(page);
});

test('a year with its own table shows no notice, and Settings names the state rate year', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if');
  await expect(page.getByRole('region', { name: 'What this means' })).toBeVisible();
  await expect(page.getByText(/rates aren't in the app yet/)).toHaveCount(0);
  await go(page, '/settings');
  // The demo keeps its own choices; every state and DC is listed, graduated-rate states ask for your rate.
  await expect(page.getByLabel('Filing status')).toHaveValue('married-joint');
  const state = page.getByLabel('State', { exact: true });
  await expect(state).toHaveValue('ID');
  await expect(state.getByRole('option', { name: 'Idaho 5.3% · 2026 rate' })).toBeAttached();
  await expect(state.getByRole('option', { name: 'California (enter your rate)' })).toBeAttached();
  await expect(state.getByRole('option', { name: 'District of Columbia (enter your rate)' })).toBeAttached();
  await expect(state.locator('option')).toHaveCount(51 + 2);
});

test('a new book: filing status and state start Not set, Tax asks once, and each change shows Saved ✓ by its field', async ({ page }) => {
  await setUp(page);
  await go(page, '/tax');
  const prompt = page.getByRole('link', { name: 'Set your filing status, state and income for tax estimates' });
  await expect(page.getByText('Assumes $0 other income. Set your income in Settings.')).toBeVisible();
  await expect(prompt).toBeVisible();
  await expectNoViolations(page);
  await prompt.click();
  await expect(page).toHaveURL(/\/settings#taxes$/);
  const filing = page.getByLabel('Filing status');
  const state = page.getByLabel('State', { exact: true });
  await expect(filing.locator('option:checked')).toHaveText('Not set');
  await expect(state.locator('option:checked')).toHaveText('Not set');

  await filing.selectOption('single');
  const taxes = page.getByRole('region', { name: 'Filing and income' });
  await expect(taxes.getByText('Saved ✓')).toHaveCount(1);
  const mark = await taxes.getByText('Saved ✓').boundingBox();
  const label = await taxes.getByText('Filing status', { exact: true }).boundingBox();
  expect(Math.abs((mark?.y ?? 0) - (label?.y ?? 100))).toBeLessThan(8); // on the filing status label line

  await state.selectOption('CA');
  const rate = page.getByLabel('Your California tax rate');
  await expect(rate).toBeVisible();
  await expect(taxes).toContainText('last year’s state tax divided by your taxable income');
  await rate.fill('6.2');
  await rate.press('Tab');
  await expect(async () => {
    const m = await taxes.getByText('Saved ✓').boundingBox();
    const r = await rate.boundingBox();
    expect(m).not.toBeNull();
    expect(r).not.toBeNull();
    expect((m?.y ?? 0) < (r?.y ?? 0) && (r?.y ?? 0) - (m?.y ?? 0) < 40).toBe(true); // just above the rate box
  }).toPass();
  await expect(filing.locator('option', { hasText: 'Not set' })).toHaveCount(0);
  await expectNoViolations(page);

  await go(page, '/tax');
  // Income was never entered: the prompt asks for it alone, and the estimates say what they assume.
  await expect(page.getByRole('link', { name: 'Set your income for tax estimates' })).toBeVisible();
  await expect(page.getByText('Assumes $0 other income. Set your income in Settings.')).toBeVisible();
  await go(page, '/settings#taxes');
  const wages = page.getByLabel('Wages and other income (a year)');
  await expect(wages).toHaveValue('');
  await wages.fill('0');
  await wages.blur();
  await expect(taxes.getByText('Saved ✓')).toHaveCount(1);
  await go(page, '/tax');
  // A saved $0 is an answer: no prompt, no note.
  await expect(page.getByRole('link', { name: /for tax estimates$/ })).toHaveCount(0);
  await expect(page.getByText('Assumes $0 other income.', { exact: false })).toHaveCount(0);
});

test('Settings › App shows the version and build, linked to the commit', async ({ page }) => {
  await openDemo(page);
  await go(page, '/settings#app');
  const line = page.getByTestId('app-version');
  await expect(line).toHaveText(/^Version 1\.0\.0 · build ([0-9a-f]{7}|dev)( · [A-Z][a-z]{2} \d{1,2}, \d{4})?$/);
  const build = line.getByRole('link', { name: /^build [0-9a-f]{7}$/ });
  if ((await build.count()) > 0) {
    await expect(build).toHaveAttribute('href', /^https:\/\/github\.com\/ecuaryan\/bitcoin-basis\/commit\/[0-9a-f]{40}$/);
    await expect(build).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(page.getByRole('link', { name: 'Verify this build' })).toHaveAttribute('href', /docs\/deploy\.md#verifying-a-deployment$/);
});

test('choosing the default state (Idaho) or filing status (Single) is saved, and stays after leaving Settings', async ({ page }) => {
  await setUp(page);
  await go(page, '/settings');
  await page.getByLabel('State').selectOption('ID');
  await expect(page.getByText('Saved ✓')).toBeVisible();
  await page.getByLabel('Filing status').selectOption('single');
  await expect(page.getByText('Saved ✓')).toBeVisible();
  await page.waitForTimeout(1800);
  await go(page, '/');
  await go(page, '/settings');
  await expect(page.getByLabel('State')).toHaveValue('ID');
  await expect(page.getByLabel('Filing status')).toHaveValue('single');
});
