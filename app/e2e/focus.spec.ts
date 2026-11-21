import { expect, test, type Locator, type Page } from '@playwright/test';

async function openBought(page: Page): Promise<Locator> {
  await page.addInitScript(() => window.localStorage.setItem('bb.hide', '0'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log something' }).or(page.getByRole('button', { name: 'Log', exact: true })).first().click();
  const d = page.getByRole('dialog', { name: 'Log' });
  await expect(d).toBeVisible();
  await d.getByRole('tab', { name: 'Bought' }).click();
  return d;
}

test('a formatted input draws exactly one focus ring (the box), not one more inside', async ({ page }) => {
  const d = await openBought(page);
  const input = d.getByLabel('Total paid, including fees');
  await input.focus();
  const rings = await input.evaluate((el) => {
    const frame = el.parentElement as HTMLElement;
    const own = getComputedStyle(el);
    const box = getComputedStyle(frame);
    return { inner: `${own.outlineStyle} ${own.outlineWidth}`, frame: `${box.outlineStyle} ${box.outlineWidth}`, frameBorder: box.borderTopColor };
  });
  expect(rings.inner).toMatch(/^none/);
  expect(rings.frame).toBe('solid 2px');
});

test('the big amount is never clipped: room above and below the glyphs at every size', async ({ page }) => {
  const d = await openBought(page);
  const amount = d.getByLabel('Amount', { exact: true });
  await amount.fill('0.00017005');
  const m = await amount.evaluate((el) => {
    const c = getComputedStyle(el);
    const fs = parseFloat(c.fontSize);
    return { lh: parseFloat(c.lineHeight) / fs, overflow: c.overflowY, fits: el.scrollHeight <= el.clientHeight };
  });
  expect(m.lh).toBeGreaterThanOrEqual(1.3);
  expect(m.fits).toBe(true);
});
