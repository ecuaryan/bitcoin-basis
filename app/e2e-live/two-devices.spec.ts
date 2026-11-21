import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Two (then four) devices against a real deployment, each with its own virtual passkey authenticator.
 * Everything below is synthetic. Config comes from the environment, never from this file.
 */
const BASE_URL = process.env['BB_LIVE_URL'] ?? '';
const SETUP_CODE = process.env['BB_LIVE_SETUP_CODE'] ?? '';
const SHOTS = process.env['BB_LIVE_SHOTS'] ?? '';
const CF_ACCOUNT = process.env['BB_LIVE_CF_ACCOUNT'] ?? '';
const DATA_BUCKET = process.env['BB_LIVE_DATA_BUCKET'] ?? '';
const HERE = dirname(fileURLToPath(import.meta.url));
const WRANGLER = process.env['BB_LIVE_WRANGLER'] ?? resolve(HERE, '../../node_modules/.bin/wrangler');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Synthetic data. The markers must never appear in anything stored on the server.
const WALLET_1 = 'Zebra Vault QX7';
const WALLET_2 = 'Okapi Cold QX7';
const NOTE = 'ZZ-private-note-7731';
const BUY_BTC = '0.03456789';
const BUY_PAID = '1234.56';
const MOVE_BTC = '0.01000000';
const SELL_BTC = '0.00500000';
const SELL_USD = '321.09';
const MARKERS = [WALLET_1, WALLET_2, NOTE, 'QX7', '7731', '3456789', '0.03456789', '1234.56', '123456', '321.09', '32109', '1000000', '500000'];

interface Device {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

async function newDevice(browser: Browser, name: string, kind: 'phone' | 'desktop'): Promise<Device> {
  const context = await browser.newContext(
    kind === 'phone'
      ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: ANDROID_UA, colorScheme: 'dark', baseURL: BASE_URL }
      : { viewport: { width: 1440, height: 1000 }, userAgent: MAC_UA, colorScheme: 'dark', baseURL: BASE_URL },
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
  return { name, context, page };
}

async function shot(d: Device, label: string): Promise<void> {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await d.page.screenshot({ path: join(SHOTS, `${d.name}-${label}.png`) });
}

async function readCode(page: Page): Promise<string> {
  const list = page.getByRole('list', { name: /Recovery code, six groups/ }).first();
  const groups = await list.locator('li span.font-display').allInnerTexts();
  return groups.join('-');
}

async function expectSynced(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Sync: Synced' }).first()).toBeAttached({ timeout: 60_000 });
}

/** Wait until local changes have reached the server (a short "Waiting to sync" may flash first). */
async function settleSync(page: Page): Promise<void> {
  await page.waitForTimeout(1500);
  await expectSynced(page);
}

async function goTab(page: Page, name: 'Holdings' | 'Records'): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

async function goRecords(page: Page, tile: 'Wallets' | 'Security'): Promise<void> {
  await goTab(page, 'Records');
  await page.getByRole('link', { name: new RegExp(`^${tile}`) }).click();
}

async function syncNow(page: Page): Promise<void> {
  await goRecords(page, 'Security');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced.', { exact: true })).toBeVisible({ timeout: 60_000 });
}

async function addWallet(page: Page, name: string, type: 'Exchange' | 'Self-custody'): Promise<void> {
  await goRecords(page, 'Wallets');
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const d = page.getByRole('dialog').last();
  await d.getByLabel('Name', { exact: true }).fill(name);
  await d.getByRole('radio', { name: type }).click();
  await d.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function openLog(page: Page, tab: string): Promise<void> {
  await page.getByRole('button', { name: 'Log something' }).or(page.getByRole('button', { name: 'Log', exact: true })).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab }).click();
}

async function saveEntry(page: Page, review: string, save: string): Promise<void> {
  const d = page.getByRole('dialog').last();
  await d.getByRole('button', { name: review }).click();
  await d.getByRole('button', { name: save }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function logBuy(page: Page): Promise<void> {
  await openLog(page, 'Bought');
  const d = page.getByRole('dialog').last();
  await d.getByLabel('Amount', { exact: true }).fill(BUY_BTC);
  await d.getByLabel('Total paid, including fees').fill(BUY_PAID);
  await d.getByLabel('When', { exact: true }).fill('2021-03-05T10:00');
  await d.getByLabel('Wallet', { exact: true }).selectOption({ label: WALLET_1 });
  await d.getByText('More details').click();
  await d.getByLabel('Note', { exact: true }).fill(NOTE);
  await saveEntry(page, 'Review purchase', 'Save purchase');
}

async function logMove(page: Page): Promise<void> {
  await openLog(page, 'Moved');
  const d = page.getByRole('dialog').last();
  await d.getByLabel('From', { exact: true }).selectOption({ label: WALLET_1 });
  await d.getByLabel('To', { exact: true }).selectOption({ label: WALLET_2 });
  await d.getByLabel('Amount that arrives').fill(MOVE_BTC);
  await d.getByLabel('When', { exact: true }).fill('2021-03-06T10:00');
  await saveEntry(page, 'Review move', 'Save move');
}

async function logSale(page: Page): Promise<void> {
  await openLog(page, 'Sold');
  const d = page.getByRole('dialog').last();
  await d.getByLabel('From wallet').selectOption({ label: WALLET_1 });
  await d.getByLabel('Amount', { exact: true }).fill(SELL_BTC);
  await d.getByLabel('Dollars you received').fill(SELL_USD);
  await d.getByLabel('When', { exact: true }).fill('2021-06-07T10:00');
  await saveEntry(page, 'Review sale', 'Save sale');
}

/** What Holdings shows that does not depend on the live price: every BTC amount, plus the wallet names. */
async function holdings(page: Page): Promise<{ btc: string[]; wallets: string[] }> {
  await goTab(page, 'Holdings');
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await expect(page.getByText(/\d\.\d{4} \d{4} BTC/).first()).toBeVisible();
  const text = await page.locator('main').innerText();
  const btc = [...new Set(text.match(/\d+\.\d{4} \d{4} BTC/g) ?? [])].sort();
  const wallets = [WALLET_1, WALLET_2].filter((w) => text.includes(w));
  return { btc, wallets };
}

async function restoreWithCode(d: Device, code: string): Promise<void> {
  await d.page.goto('/');
  await d.page.getByRole('button', { name: 'Restore on this device' }).click();
  await d.page.getByLabel('Recovery code', { exact: true }).fill(code);
  await d.page.getByRole('button', { name: 'Restore my records' }).click();
}

async function restoreAndEnter(d: Device, code: string, addPasskey: boolean): Promise<void> {
  await restoreWithCode(d, code);
  await expect(d.page.getByRole('heading', { name: 'Records restored' })).toBeVisible({ timeout: 60_000 });
  await shot(d, 'restored');
  await d.page.getByRole('button', { name: addPasskey ? 'Add a passkey on this device' : 'Not now' }).click();
  await expect(d.page.getByRole('heading', { name: 'Holdings' })).toBeVisible({ timeout: 60_000 });
}

/** Every object in the data bucket (names and sizes) through the Cloudflare API, using the wrangler login. The token is never printed. */
async function listBucket(): Promise<{ key: string; size: number }[]> {
  const token = (JSON.parse(execFileSync(WRANGLER, ['auth', 'token', '--json'], { encoding: 'utf8' })) as { token: string }).token;
  const out: { key: string; size: number }[] = [];
  let cursor = '';
  for (;;) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets/${DATA_BUCKET}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { success: boolean; result: { key: string; size: number }[]; result_info?: { cursor?: string; is_truncated?: boolean } };
    expect(body.success, 'bucket listing succeeded').toBe(true);
    out.push(...body.result);
    if (body.result_info?.is_truncated !== true || !body.result_info.cursor) break;
    cursor = body.result_info.cursor;
  }
  return out;
}

function readObject(key: string): Buffer {
  const token = (JSON.parse(execFileSync(WRANGLER, ['auth', 'token', '--json'], { encoding: 'utf8' })) as { token: string }).token;
  return execFileSync('curl', ['-s', '-H', `Authorization: Bearer ${token}`, `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets/${DATA_BUCKET}/objects/${encodeURIComponent(key)}`], { maxBuffer: 10_000_000 });
}

test('two devices: setup, sync, restore, lock, fresh device, rotate, and an opaque server', async ({ browser }) => {
  test.skip(BASE_URL === '' || SETUP_CODE === '', 'Set BB_LIVE_URL and BB_LIVE_SETUP_CODE to run against a live deployment.');

  // ---- a. Device A (phone): set up -------------------------------------------------------------
  const A = await newDevice(browser, 'A-phone', 'phone');
  const a = A.page;
  await a.goto('/');
  await expect(a.getByRole('heading', { name: /on the record/ })).toBeVisible();
  await shot(A, '01-welcome');
  await a.getByLabel('Setup code from your install script').fill(SETUP_CODE);
  await a.getByRole('button', { name: 'Claim and create my passkey' }).click();
  await expect(a.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible({ timeout: 60_000 });
  const code1 = await readCode(a);
  expect(code1).toMatch(/^([0-9A-Z]{5}-){5}[0-9A-Z]{5}$/);
  await shot(A, '02-recovery-code');
  await a.getByRole('button', { name: 'I wrote it down' }).click();
  await a.getByLabel('Group 4 of your recovery code').fill(code1.split('-')[3] as string);
  await a.getByRole('button', { name: 'Continue' }).click();
  await a.getByRole('button', { name: 'Go to my records' }).click();
  await expect(a.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await shot(A, '03-empty-holdings');

  // Unlock wording on Android: fingerprint, never Face ID.
  await a.getByRole('button', { name: 'Lock', exact: true }).click();
  const unlockA = a.getByRole('button', { name: /^Unlock with/ });
  await expect(unlockA).toHaveText('Unlock with fingerprint or screen lock');
  await expect(a.locator('body')).not.toContainText(/Face ID/i);
  await expect(a.locator('body')).not.toContainText(/Touch ID/i);
  await shot(A, '04-unlock-android');
  await unlockA.click();
  await expect(a.getByRole('heading', { name: 'Holdings' })).toBeVisible();

  // ---- b. A: wallets, a buy and a move ---------------------------------------------------------
  await addWallet(a, WALLET_1, 'Exchange');
  await addWallet(a, WALLET_2, 'Self-custody');
  await logBuy(a);
  await logMove(a);
  const holdingsA1 = await holdings(a);
  expect(holdingsA1.wallets).toEqual([WALLET_1, WALLET_2]);
  expect(holdingsA1.btc.length).toBeGreaterThan(0);
  await shot(A, '05-holdings-after-buy-move');
  await settleSync(a);

  // ---- c. Device B (desktop): restore from the recovery code, then add its own passkey ---------
  const B = await newDevice(browser, 'B-desktop', 'desktop');
  const b = B.page;
  await restoreAndEnter(B, code1, true);
  const holdingsB1 = await holdings(b);
  expect(holdingsB1).toEqual(holdingsA1);
  await shot(B, '06-holdings-restored');

  // ---- d. B logs a sale, A syncs and sees it; both agree ---------------------------------------
  await logSale(b);
  await settleSync(b);
  const holdingsB2 = await holdings(b);
  expect(holdingsB2.btc).not.toEqual(holdingsB1.btc);
  await shot(B, '07-holdings-after-sale');
  await syncNow(a);
  const holdingsA2 = await holdings(a);
  expect(holdingsA2).toEqual(holdingsB2);
  await shot(A, '08-holdings-synced-from-B');

  // ---- e. Lock A and unlock with its passkey; reload B and unlock with its own passkey ---------
  await a.getByRole('button', { name: 'Lock', exact: true }).click();
  await a.getByRole('button', { name: /^Unlock with/ }).click();
  await expect(a.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  expect(await holdings(a)).toEqual(holdingsA2);

  await b.reload();
  const unlockB = b.getByRole('button', { name: /^Unlock with/ });
  await expect(unlockB).toHaveText('Unlock with Touch ID');
  await shot(B, '09-unlock-desktop');
  await unlockB.click();
  await expect(b.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  expect(await holdings(b)).toEqual(holdingsA2);

  // ---- f. Fresh device C: recovery code alone ---------------------------------------------------
  const C = await newDevice(browser, 'C-fresh', 'desktop');
  await restoreAndEnter(C, code1, false);
  expect(await holdings(C.page)).toEqual(holdingsA2);
  await shot(C, '10-holdings-fresh-device');
  await C.context.close();

  // ---- g. Rotate the recovery code on A ---------------------------------------------------------
  await goRecords(a, 'Security');
  await a.getByRole('button', { name: 'Make a new recovery code' }).click();
  await a.getByRole('button', { name: 'Make a new code' }).click();
  await expect(a.getByRole('article', { name: 'Emergency kit' })).toBeVisible({ timeout: 60_000 });
  const slots = await a.getByRole('list', { name: 'Recovery code groups' }).locator('li').allInnerTexts();
  const code2 = slots.join('-');
  expect(code2).toMatch(/^([0-9A-Z]{5}-){5}[0-9A-Z]{5}$/);
  expect(code2).not.toEqual(code1);
  await shot(A, '11-new-recovery-code');

  const D = await newDevice(browser, 'D-after-rotation', 'desktop');
  await restoreAndEnter(D, code2, false);
  expect(await holdings(D.page)).toEqual(holdingsA2);
  await shot(D, '12-holdings-new-code');
  await D.context.close();

  const E = await newDevice(browser, 'E-old-code', 'desktop');
  await restoreWithCode(E, code1);
  await expect(E.page.getByRole('alert')).toBeVisible({ timeout: 60_000 });
  await expect(E.page.getByRole('heading', { name: 'Records restored' })).toHaveCount(0);
  await shot(E, '13-old-code-refused');
  await E.context.close();

  // Device B (not rotated by itself) still opens with its own passkey and shows the same records.
  await b.reload();
  await b.getByRole('button', { name: /^Unlock with/ }).click();
  await expect(b.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await b.waitForTimeout(1000);
  await syncNow(b);
  expect(await holdings(b)).toEqual(holdingsA2);

  // ---- h. The server only holds ciphertext of the allowed sizes ---------------------------------
  if (CF_ACCOUNT !== '' && DATA_BUCKET !== '') {
    const objects = await listBucket();
    expect(objects.length).toBeGreaterThan(5);
    const allowed = new Set([1024, 4096, 16384, 65536].map((n) => n + 1 + 4 + 12 + 16));
    const blobs = objects.filter((o) => o.key.startsWith('e/'));
    expect(blobs.length).toBeGreaterThan(0);
    for (const o of blobs) expect(allowed.has(o.size), `blob ${o.key} has size ${o.size}`).toBe(true);
    const sample = objects.filter((o) => !o.key.startsWith('used/') && !o.key.startsWith('revoked/') && !o.key.startsWith('backup-progress/'));
    const leaks: string[] = [];
    for (const o of sample) {
      const body = readObject(o.key);
      const latin = body.toString('latin1');
      const utf = body.toString('utf8');
      for (const m of MARKERS) if (latin.includes(m) || utf.includes(m)) leaks.push(`${o.key}: ${m}`);
    }
    expect(leaks).toEqual([]);
    test.info().annotations.push({ type: 'server', description: `${objects.length} objects, ${blobs.length} sealed blobs, sizes ${[...new Set(blobs.map((o) => o.size))].join(',')}` });
  }

  await A.context.close();
  await B.context.close();
});
