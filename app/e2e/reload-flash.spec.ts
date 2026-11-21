import { expect, test } from '@playwright/test';
import { setUp } from './fake.ts';

// The fake build lives in one page (a real reload would reset it), so this locks and unlocks: the same
// store path as a reload (stop, then start from the local copy) with the network listing hanging.
test('unlock never flashes an empty book while the network is slow', async ({ page }) => {
  await setUp(page);
  await page.evaluate(async () => {
    const f = window.__bbFake;
    if (!f) throw new Error('no fake');
    const at = '2025-03-01T12:00:00Z';
    const tz = 'America/Denver';
    await f.vault.store.append([
      { id: 'w1', at, tz, kind: 'wallet', wallet: 'strike', name: 'Strike', type: 'exchange', defaultProof: 'Email receipt' },
      { id: 'b1', at, tz, kind: 'buy', wallet: 'strike', sats: 1_000_000, costCents: 80_000, tier: 'documented' },
    ] as never);
    await f.vault.sync();
    f.vault.lock();
  });
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __seenEmpty: string[] };
    w.__seenEmpty = [];
    const bad = /Nothing logged yet|0 active|Add my first wallet/;
    const check = () => {
      const t = document.body.innerText;
      const m = bad.exec(t);
      if (m) w.__seenEmpty.push(m[0]);
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
    const f = window.__bbFake;
    if (f) f.client.hangList = true;
  });
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('Strike').first()).toBeVisible();
  const seen = () => page.evaluate(() => (window as unknown as { __seenEmpty: string[] }).__seenEmpty);
  expect(await seen()).toEqual([]);
  await page.getByRole('link', { name: 'Records', exact: true }).click();
  await expect(page.getByText('1 active')).toBeVisible();
  expect(await seen()).toEqual([]);
});
