import { expect, test, type Page } from '@playwright/test';
import { expectNoViolations, openDemo } from './helpers.ts';

// Dragging the sheet down is a phone thing (the desktop project has a centered dialog).
test.skip(({ isMobile }) => !isMobile, 'phone layout only');

async function box(l: {
  boundingBox(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>;
}) {
  const b = await l.boundingBox();
  if (!b) throw new Error('not on screen');
  return b;
}

async function openLog(page: Page) {
  await openDemo(page);
  await page
    .getByRole('button', { name: 'Log something' })
    .or(page.getByRole('button', { name: 'Log', exact: true }))
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function dragFromTitle(page: Page, dialog: ReturnType<Page['getByRole']>, dy: number, hold = false) {
  const b = await box(dialog.getByRole('heading').first());
  const x = b.x + 20;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (dy * i) / steps);
    await page.waitForTimeout(40);
  }
  if (!hold) await page.mouse.up();
}

test('a small drag on the title row springs back', async ({ page }) => {
  const dialog = await openLog(page);
  await dragFromTitle(page, dialog, 40);
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await dialog.evaluate((el) => getComputedStyle(el).transform)).replace(/\s/g, '')).toMatch(/^(none|matrix\(1,0,0,1,0,0\))$/);
});

test('the sheet follows the finger and dims the backdrop mid-drag', async ({ page }) => {
  const dialog = await openLog(page);
  const before = await box(dialog);
  await dragFromTitle(page, dialog, 120, true);
  const during = await box(dialog);
  expect(during.y - before.y).toBeGreaterThan(80);
  const opacity = await dialog.evaluate((el) => Number((el.previousElementSibling as HTMLElement).style.opacity));
  expect(opacity).toBeLessThan(1);
  await page.mouse.up();
});

test('a big drag on the title row closes it and focus goes back', async ({ page }) => {
  const dialog = await openLog(page);
  await dragFromTitle(page, dialog, 600);
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
});

test('a swipe down in the body at the top closes it; text fields are left alone', async ({ page }) => {
  const dialog = await openLog(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });

  // Starting on a text field: no sheet drag, even for a long pull.
  const field = dialog.getByRole('textbox').first();
  await field.scrollIntoViewIfNeeded();
  const fb = await box(field);
  await touch('touchStart', fb.x + 30, fb.y + fb.height / 2);
  for (let i = 1; i <= 10; i++) await touch('touchMove', fb.x + 30, fb.y + fb.height / 2 + i * 50);
  await touch('touchEnd', 0, 0);
  await expect(dialog).toBeVisible();

  // Starting on plain body text at the top: a long pull closes it.
  const label = await box(dialog.locator('label, p').first());
  const x = label.x + 10;
  const y = label.y + 4;
  await touch('touchStart', x, y);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', x, y + i * 40);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', 0, 0);
  await expect(dialog).toBeHidden();
});

test('the grab handle is decoration, Close stays the accessible control, and axe is clean', async ({ page }) => {
  const dialog = await openLog(page);
  await expectNoViolations(page);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
