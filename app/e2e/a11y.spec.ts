import { expect, test, type Page } from '@playwright/test';
import { expectNoViolations, go, openDemo } from './helpers.ts';

/** Axe on every route and on the sheets, at both sizes (the two Playwright projects). */

const ROUTES: { path: string }[] = [
  { path: '/' },
  { path: '/what-if' },
  { path: '/what-if?mode=borrow' },
  { path: '/tax' },
  { path: '/tax/summary/2026' },
  { path: '/records?v=entries' },
  { path: '/records?v=closed' },
  { path: '/records?v=wallets' },
  { path: '/records?v=io' },
  { path: '/records?v=loans' },
  { path: '/loans/loan-home-equity' },
  { path: '/settings' },
  { path: '/wallet/wallet-strike' },
  { path: '/wallet/wallet-cold' },
  { path: '/kit' },
  { path: '/nowhere' },
];

for (const r of ROUTES) {
  test(`axe: ${r.path}`, async ({ page }) => {
    await openDemo(page);
    await go(page, r.path);
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expectNoViolations(page);
  });
}

test('axe: first run (Welcome)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible();
  await expectNoViolations(page);
});

test('axe: the gift note page', async ({ page }) => {
  await openDemo(page);
  await go(page, '/wallet/wallet-strike');
  await expect(page.getByRole('region', { name: 'Entries' })).toBeVisible();
  const showMore = page.getByRole('button', { name: /^Show all \d+ entries/ });
  const gave = page.getByRole('button', { name: /^Gave.* to Sam/ });
  while ((await gave.count()) === 0 && (await showMore.count()) > 0) await showMore.click();
  await gave.first().click();
  await page.getByRole('link', { name: 'Open the gift note' }).click();
  await expect(page.locator('h1').first()).toBeVisible();
  await expectNoViolations(page);
});

async function openLogSheet(page: Page, tab: string) {
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab }).click();
  return dialog;
}

for (const tab of ['Bought', 'Received', 'Moved', 'Sold or spent', 'Gave']) {
  test(`axe: Log sheet, ${tab}`, async ({ page }) => {
    await openDemo(page);
    await openLogSheet(page, tab);
    await expectNoViolations(page);
  });
}

test('axe: the other sheets (year, add wallet, wallet menu, edit)', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /Show the 2023 lots and where each came from/ }).click();
  await expect(page.getByRole('dialog', { name: '2023 lots' })).toBeVisible();
  await expectNoViolations(page);
  await page.keyboard.press('Escape');

  await go(page, '/records?v=wallets');
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a wallet' })).toBeVisible();
  await expectNoViolations(page);
  await page.keyboard.press('Escape');

  await go(page, '/wallet/wallet-strike');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.getByRole('button', { name: /Bought/ }).first().click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoViolations(page);
});

test('axe: Sell sheets (pick coins, review)', async ({ page }) => {
  await openDemo(page);
  await go(page, '/what-if');
  await page.getByRole('button', { name: 'Pick lots' }).click();
  await expect(page.getByRole('dialog', { name: 'Pick lots' })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Use these lots' }).click();
  await page.getByRole('button', { name: 'I sold it, log it' }).click();
  await expect(page.getByRole('dialog', { name: 'Log your sale' })).toBeVisible();
  await expectNoViolations(page);
});

test('reduced motion is honored: no running animations', async ({ page }) => {
  await openDemo(page);
  await openLogSheet(page, 'Bought');
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 5).length);
  expect(running).toBe(0);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
});

// ---- Keyboard only ---------------------------------------------------------------------

async function focusOutlineVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    // The date field's inner picker button draws the browser's own focus ring.
    if (el instanceof HTMLInputElement && el.type === 'datetime-local') return true;
    const ring = (e: Element): boolean => {
      const s = getComputedStyle(e);
      return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    };
    // Number boxes draw their one ring on the frame around the bare input.
    return ring(el) || (el instanceof HTMLInputElement && el.parentElement !== null && ring(el.parentElement));
  });
}

/** Tab until `pred` matches the focused element (max `limit` presses), checking a focus ring on each stop. */
async function tabTo(page: Page, name: RegExp | string, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      const labelled = el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? [...(el.labels ?? [])].map((l) => l.innerText).join(' ') : '';
      return el.getAttribute('aria-label') ?? (el.innerText || labelled || el.tagName);
    });
    expect(await focusOutlineVisible(page), `focus ring on "${label}"`).toBe(true);
    if (typeof name === 'string' ? label.trim() === name : name.test(label)) return;
  }
  throw new Error(`Tab never reached ${String(name)}`);
}

test('keyboard only: log a purchase, Esc closes, focus returns', async ({ page, isMobile }) => {
  test.skip(isMobile === true, 'Keyboard walk-through runs on desktop');
  await openDemo(page);
  await tabTo(page, /^Log$/);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Amount', { exact: true })).toBeVisible();
  // Focus moved into the sheet.
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  // Esc closes and focus goes back to the Log button.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Amount', { exact: true }).focus();
  await page.keyboard.type('0.01');
  await page.keyboard.press('Tab');
  await tabTo(page, /Total paid/);
  await page.keyboard.type('750');
  await tabTo(page, 'Save purchase');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('3.7267 2105 BTC')).toBeVisible();
});

test('keyboard only: log a sale, tab stays inside the sheet, Esc and focus return', async ({ page, isMobile }) => {
  test.skip(isMobile === true, 'Keyboard walk-through runs on desktop');
  await openDemo(page);
  const dialog = await openLogSheet(page, 'Sold or spent');
  await dialog.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await dialog.getByLabel('Amount', { exact: true }).fill('0.002');
  // Tab around the whole sheet: focus never leaves the dialog.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), `tab ${i} stays in the dialog`).toBe(true);
    expect(await focusOutlineVisible(page), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200) ?? '')).toBe(true);
  }
  await tabTo(page, 'Review sale');
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Taxable gain')).toBeVisible();
  await tabTo(page, 'Save sale');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Esc from a fresh sheet puts focus back on the Log button.
  await page.getByRole('button', { name: 'Log', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeFocused();
});

/** The name a screen reader would read for an element (enough for buttons and links: label, labelled-by, text, title). */
async function names(page: Page, selector: string): Promise<{ html: string; name: string }[]> {
  return page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }))
      .map((el) => {
        const by = el.getAttribute('aria-labelledby');
        const labelled = by === null ? '' : by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
        const name = (el.getAttribute('aria-label') ?? '') || labelled || (el as HTMLElement).innerText || el.getAttribute('title') || '';
        return { html: el.outerHTML.slice(0, 120), name: name.trim() };
      }),
  );
}

test('icon-only buttons have names: Hide amounts and Show amounts, Settings, Lock, Log', async ({ page, isMobile }) => {
  await openDemo(page);
  if (isMobile) {
    const header = page.locator('header').first();
    await expect(header.getByRole('button', { name: 'Hide amounts', exact: true })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log', exact: true })).toBeVisible();
    await header.getByRole('button', { name: 'Hide amounts', exact: true }).click();
    await expect(header.getByRole('button', { name: 'Show amounts', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Hide amounts', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeVisible();
  }
  // Every visible button and link on the busiest screens has a name.
  for (const path of ['/', `/wallet/wallet-strike`, '/loans/loan-home-equity', '/what-if', '/records', '/settings']) {
    await go(page, path);
    await expect(page.locator('h1, h2').first()).toBeVisible();
    expect((await names(page, 'button, a[href]')).filter((n) => n.name === ''), path).toEqual([]);
  }
  const log = await openLogSheet(page, 'Moved');
  expect((await names(page, '[role="dialog"] button, [role="dialog"] a[href]')).filter((n) => n.name === '')).toEqual([]);
  await expect(log.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
});

test('a sheet opens within 250 ms, and with no motion when motion is reduced', async ({ page }) => {
  await openDemo(page);
  const duration = async () => {
    await page.getByRole('button', { name: 'Log', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Log' });
    await expect(dialog).toBeVisible();
    const s = await dialog.evaluate((el) => getComputedStyle(el).animationDuration);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return Math.max(...s.split(',').map((d) => (d.trim().endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000)));
  };
  expect(await duration()).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const ms = await duration();
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThanOrEqual(250);
});

test('a toast never covers the header or the brand', async ({ page, isMobile }) => {
  await openDemo(page);
  // In the demo, Lock explains itself in a toast.
  await page.getByRole('button', { name: 'Lock', exact: true }).first().click();
  const toast = page.getByText('This is the demo, so there is nothing to lock.');
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  const brand = await page.getByRole('link', { name: 'Bitcoin Basis, go to Holdings' }).boundingBox();
  expect(box).not.toBeNull();
  expect(brand).not.toBeNull();
  if (box === null || brand === null) return;
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(box, brand)).toBe(false);
  if (isMobile) {
    const header = await page.locator('header').first().boundingBox();
    expect(header).not.toBeNull();
    if (header !== null) expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  }
});
