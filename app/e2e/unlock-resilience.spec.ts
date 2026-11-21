import { expect, test, type Page } from '@playwright/test';
import { setUp } from './fake.ts';

// Unlock must never hang on a phone: a server that goes quiet, a passkey prompt the phone never shows.
test.skip(({ isMobile }) => !isMobile, 'phone project only');

/** Set up, add a wallet so there is something to see, sync, then press Lock. */
async function lockedWithRecords(page: Page): Promise<void> {
  await setUp(page);
  await page.evaluate(async () => {
    const f = window.__bbFake;
    if (!f) throw new Error('no fake');
    const at = '2025-03-01T12:00:00Z';
    const tz = 'America/Denver';
    await f.vault.store.append([{ id: 'w1', at, tz, kind: 'wallet', wallet: 'strike', name: 'Strike', type: 'exchange', defaultProof: 'Email receipt' }] as never);
    await f.vault.sync();
  });
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
}

test('a server that hangs at sign-in: the phone shows each step and opens its own copy', async ({ page }) => {
  await lockedWithRecords(page);
  await page.evaluate(() => {
    const f = window.__bbFake;
    if (f) f.client.hang = (path) => path.startsWith('/api/login/');
  });
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connecting…' })).toBeVisible();
  await expect(page.getByText('Strike').first()).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__bbFake?.vault.status.state)).toBe('unlocked');
});

test('a passkey prompt the phone never shows: tapping again starts over and unlocks', async ({ page }) => {
  await lockedWithRecords(page);
  await page.evaluate(() => {
    const f = window.__bbFake;
    if (f) f.auth.hangGets = 1;
  });
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const waiting = page.getByRole('button', { name: /^Waiting for/ });
  await expect(waiting).toBeVisible();
  await expect(waiting).toBeEnabled();
  await waiting.click();
  await expect(page.getByText('Strike').first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a step that never finishes: after 20 s, "Taking too long? Try again" aborts and resets the screen', async ({ page }) => {
  await lockedWithRecords(page);
  await page.clock.install();
  await page.evaluate(() => {
    const f = window.__bbFake;
    if (f) f.auth.hangGets = 1;
  });
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Waiting for/ })).toBeVisible();
  await page.clock.runFor(21_000);
  const retry = page.getByRole('button', { name: 'Taking too long? Try again' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.__bbFake?.vault.unlocking)).toBe(false);
  // And the next tap works.
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('Strike').first()).toBeVisible();
});
