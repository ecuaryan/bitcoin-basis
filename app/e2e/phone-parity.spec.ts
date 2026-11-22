import { expect, test } from '@playwright/test';
import { setUp } from './fake.ts';
import { go, openDemo } from './helpers.ts';

// Phones show the same key information as desktop (the layout may differ).

test('a long entry title wraps instead of being cut off', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Log' }).getByRole('tab', { name: 'Gave' }).click();
  const d = page.getByRole('dialog').last();
  await d.getByLabel('Amount', { exact: true }).fill('0.001');
  await d.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await d.getByLabel('Who is it for?').fill('Treasure Valley Community Foundation');
  await d.getByRole('button', { name: 'Review gift' }).click();
  await d.getByRole('button', { name: 'Save gift' }).click();
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/records');
  const title = page.getByRole('region', { name: 'Recent entries' }).getByText('Gave to Treasure Valley Community Foundation', { exact: true });
  await expect(title).toBeVisible();
  // Nothing of it is hidden: no ellipsis, no clipped second line.
  const clipped = await title.evaluate((el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
  expect(clipped).toBe(false);
});

test('saved changes still waiting to upload are shown on phones too', async ({ page }) => {
  await setUp(page);
  // Uploads never finish (a slow connection): the change stays waiting to upload.
  await page.evaluate(() => {
    const f = window.__bbFake;
    if (f) f.client.hang = (path) => path.startsWith('/api/blobs');
  });
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await page.getByRole('link', { name: /^Wallets/ }).click();
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a wallet' });
  await sheet.getByLabel('Name').fill('Strike');
  await sheet.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const waiting = page.getByRole('link', { name: /^Sync: (Syncing|Waiting to sync)\./ }).first();
  await expect(waiting).toBeVisible();
  // It fits the header beside the other buttons: nothing pushed off the screen.
  const width = page.viewportSize()?.width ?? 0;
  const box = await waiting.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  const lock = page.getByRole('button', { name: /^Lock/ }).first();
  const lockBox = await lock.boundingBox();
  expect((lockBox?.x ?? 0) + (lockBox?.width ?? 0)).toBeLessThanOrEqual(width);
});
