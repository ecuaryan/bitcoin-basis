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
  await page.getByLabel('State income tax').selectOption('flat');
  await expect(page.getByRole('option', { name: 'Idaho 5.3% · 2026 rate' })).toBeAttached();
  const last = await page.getByLabel('State income tax').locator('option').last().textContent();
  expect(last).toBe('Other state or custom rate…');
});
