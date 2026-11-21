import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Backup restore drill against a real STAGING deployment (never production): set up a vault with synthetic
 * records, run the backup cron, wipe the data bucket, restore with tools/restore-backup.mjs, then check that
 * a fresh device (recovery code) and a passkey device both see identical holdings.
 *
 * Needs a staging Worker whose config exposes a temporary authenticated path that runs the scheduled handler
 * (see docs/deploy.md, "Practising a restore"). Config comes from the environment:
 *   BB_LIVE_URL, BB_LIVE_SETUP_CODE, BB_LIVE_CRON_KEY (sent as x-cron-key to POST <url>/__cron),
 *   BB_LIVE_CF_ACCOUNT, BB_LIVE_DATA_BUCKET, BB_LIVE_BACKUP_BUCKET (all required; the data bucket must be a staging one).
 */
const BASE_URL = process.env['BB_LIVE_URL'] ?? '';
const SETUP_CODE = process.env['BB_LIVE_SETUP_CODE'] ?? '';
const CRON_KEY = process.env['BB_LIVE_CRON_KEY'] ?? '';
const CF_ACCOUNT = process.env['BB_LIVE_CF_ACCOUNT'] ?? '';
const DATA_BUCKET = process.env['BB_LIVE_DATA_BUCKET'] ?? '';
const BACKUP_BUCKET = process.env['BB_LIVE_BACKUP_BUCKET'] ?? '';
const HERE = dirname(fileURLToPath(import.meta.url));
const WRANGLER = process.env['BB_LIVE_WRANGLER'] ?? resolve(HERE, '../../node_modules/.bin/wrangler');
const RESTORE_TOOL = resolve(HERE, '../../tools/restore-backup.mjs');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Synthetic data. The markers must never appear in anything stored on the server.
const WALLET_1 = 'Zebra Vault QX7';
const WALLET_2 = 'Okapi Cold QX7';
const BUY_BTC = '0.03456789';
const BUY_PAID = '1234.56';
const MOVE_BTC = '0.01000000';

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

async function readCode(page: Page): Promise<string> {
  const list = page.getByRole('list', { name: /Recovery code, six groups/ }).first();
  const groups = await list.locator('li span.font-display').allInnerTexts();
  return groups.join('-');
}

async function goSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Security and devices' })).toBeVisible();
}

/** Open Settings and press "Check now" until the sync region says everything is up to date. */
async function syncNow(page: Page): Promise<void> {
  await goSettings(page);
  const region = page.getByRole('region', { name: 'Sync between devices' });
  await expect(async () => {
    await region.getByRole('button', { name: 'Check now' }).click();
    await expect(region).toContainText('Up to date', { timeout: 5000 });
    await expect(region).not.toContainText('Syncing', { timeout: 5000 });
  }).toPass({ timeout: 90_000 });
}

async function goTab(page: Page, name: 'Holdings' | 'Records'): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
}

async function goWallets(page: Page): Promise<void> {
  await goTab(page, 'Records');
  await page.getByRole('link', { name: /^Wallets/ }).click();
}

async function addWallet(page: Page, name: string): Promise<void> {
  await goWallets(page);
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  const d = page.getByRole('dialog', { name: 'Add a wallet' });
  await d.getByLabel('Name').fill(name);
  await d.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function openLog(page: Page, tab: string): Promise<void> {
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab }).click();
}

async function logBuy(page: Page): Promise<void> {
  await openLog(page, 'Bought');
  const d = page.getByRole('dialog').last();
  await d.getByLabel('Amount', { exact: true }).fill(BUY_BTC);
  await d.getByLabel('Total paid, including fees').fill(BUY_PAID);
  await d.getByLabel('Wallet', { exact: true }).selectOption({ label: WALLET_1 });
  await d.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function logMove(page: Page): Promise<void> {
  await openLog(page, 'Moved');
  const d = page.getByRole('dialog').last();
  await d.getByLabel('From', { exact: true }).selectOption({ label: WALLET_1 });
  await d.getByLabel('To', { exact: true }).selectOption({ label: WALLET_2 });
  await d.getByLabel('Amount that arrives').fill(MOVE_BTC);
  await d.getByRole('button', { name: 'Save move' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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

/** Restore on a device that has nothing: "I already use Bitcoin Basis" (the server already holds a vault), then the code. */
async function restoreAndEnter(d: Device, code: string, addPasskey: boolean): Promise<void> {
  await d.page.goto('/');
  await d.page.getByRole('button', { name: 'I already use Bitcoin Basis', exact: true }).click();
  await d.page.getByLabel('Recovery code', { exact: true }).fill(code);
  await d.page.getByRole('button', { name: 'Restore my records' }).click();
  await expect(d.page.getByRole('heading', { name: 'Records restored' })).toBeVisible({ timeout: 60_000 });
  await d.page.getByRole('button', { name: addPasskey ? 'Add a passkey on this device' : 'Not now' }).click();
  await expect(d.page.getByRole('heading', { name: 'Holdings' })).toBeVisible({ timeout: 60_000 });
}

/** Unlock with the passkey (the app may prompt on its own). */
async function passkeyUnlock(page: Page): Promise<void> {
  const unlock = page.getByRole('button', { name: 'Unlock', exact: true });
  const lock = page.getByRole('button', { name: 'Lock', exact: true });
  await expect(unlock.or(lock)).toBeVisible({ timeout: 60_000 });
  if (await unlock.isVisible()) await unlock.click();
  await expect(lock).toBeVisible({ timeout: 60_000 }); // unlocked: the app is back, on the page it was on
}

const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets`;
function token(): string {
  return (JSON.parse(execFileSync(WRANGLER, ['auth', 'token', '--json'], { encoding: 'utf8' })) as { token: string }).token;
}
async function listKeys(bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  let cursor = '';
  for (;;) {
    const q = `per_page=1000&prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(`${API}/${bucket}/objects?${q}`, { headers: { authorization: `Bearer ${token()}` } });
    const body = (await res.json()) as { success: boolean; result: { key: string }[]; result_info?: { cursor?: string; is_truncated?: boolean } };
    expect(body.success, `listing ${bucket}`).toBe(true);
    out.push(...body.result.map((o) => o.key));
    if (body.result_info?.is_truncated !== true || !body.result_info.cursor) break;
    cursor = body.result_info.cursor;
  }
  return out;
}
async function emptyBucket(bucket: string): Promise<number> {
  const keys = await listKeys(bucket);
  for (const k of keys) {
    const res = await fetch(`${API}/${bucket}/objects/${encodeURIComponent(k)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token()}` } });
    expect(res.ok, `delete ${k}`).toBe(true);
  }
  return keys.length;
}
async function runCron(): Promise<void> {
  const res = await fetch(`${BASE_URL}/__cron`, { method: 'POST', headers: { 'x-cron-key': CRON_KEY } });
  expect(res.status).toBe(200);
}
async function claimed(): Promise<boolean> {
  return ((await (await fetch(`${BASE_URL}/api/status`)).json()) as { claimed: boolean }).claimed;
}
function restoreTool(apply: boolean): string {
  const args = [RESTORE_TOOL, '--account-id', CF_ACCOUNT, '--data-bucket', DATA_BUCKET, '--backup-bucket', BACKUP_BUCKET, ...(apply ? ['--apply'] : [])];
  return execFileSync('node', args, { encoding: 'utf8', env: { ...process.env, BB_WRANGLER: WRANGLER } });
}

test('restore drill: backup cron, wipe the data bucket, restore, recover on fresh and passkey devices', async ({ browser }) => {
  test.skip(!BASE_URL || !SETUP_CODE || !CRON_KEY || !CF_ACCOUNT || !DATA_BUCKET || !BACKUP_BUCKET, 'Set the BB_LIVE_* variables (see the header) to run against staging.');
  expect(DATA_BUCKET).toMatch(/staging/);
  expect(BACKUP_BUCKET).toMatch(/staging/);

  // 1. Set up on a "phone" with a virtual passkey, add synthetic records, sync.
  const A = await newDevice(browser, 'A-desktop', 'desktop');
  const a = A.page;
  await a.goto('/');
  await a.getByLabel('Setup code', { exact: true }).fill(SETUP_CODE);
  await a.getByRole('button', { name: 'Claim and create my passkey' }).click();
  await expect(a.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible({ timeout: 60_000 });
  const code = await readCode(a);
  expect(code).toMatch(/^([0-9A-Z]{5}-){5}[0-9A-Z]{5}$/);
  await a.getByRole('button', { name: "I've saved it" }).click();
  await a.getByLabel('Group 4 of your recovery code').fill(code.split('-')[3] as string);
  await a.getByRole('button', { name: 'Continue' }).click();
  await expect(a.getByRole('heading', { name: "You're all set" })).toBeVisible();
  await a.getByRole('button', { name: 'Add my first wallet' }).click();
  await expect(a.getByRole('dialog', { name: 'Add a wallet' })).toBeVisible();
  await a.getByRole('dialog', { name: 'Add a wallet' }).getByLabel('Name').fill(WALLET_1);
  await a.getByRole('dialog', { name: 'Add a wallet' }).getByRole('button', { name: 'Add wallet' }).click();
  await expect(a.getByRole('dialog')).toHaveCount(0);
  await addWallet(a, WALLET_2);
  await logBuy(a);
  await logMove(a);
  const before = await holdings(a);
  expect(before.wallets).toEqual([WALLET_1, WALLET_2]);
  await syncNow(a);

  // 2. Backup cron: run it until nothing is left to copy, then check the prefix.
  await runCron();
  await runCron();
  const dataKeys = (await listKeys(DATA_BUCKET)).filter((k) => !/^(used|revoked|backup-progress)\//.test(k));
  const backupKeys = await listKeys(BACKUP_BUCKET);
  expect(backupKeys.length).toBeGreaterThan(5);
  const vaultIds = [...new Set(backupKeys.map((k) => k.split('/')[1]))];
  expect(vaultIds).toHaveLength(1);
  expect(backupKeys.every((k) => k.startsWith(`vault/${vaultIds[0]}/`))).toBe(true);
  expect(backupKeys.map((k) => k.slice(`vault/${vaultIds[0]}/`.length)).sort()).toEqual([...dataKeys].sort());

  // 3. Disaster: empty the data bucket. The instance looks unclaimed.
  const wiped = await emptyBucket(DATA_BUCKET);
  expect(wiped).toBeGreaterThan(5);
  expect(await listKeys(DATA_BUCKET)).toEqual([]);
  expect(await claimed()).toBe(false);

  // 4. Restore: dry run writes nothing, --apply copies, a second --apply copies nothing.
  const dry = restoreTool(false);
  expect(dry).toContain('Dry run');
  expect(await listKeys(DATA_BUCKET)).toEqual([]);
  const applied = restoreTool(true);
  expect(applied).toMatch(/Done: \d+ copied, 0 already present/);
  expect((await listKeys(DATA_BUCKET)).sort()).toEqual([...dataKeys].sort());
  expect(restoreTool(true)).toContain('Nothing to restore');
  expect(await claimed()).toBe(true);

  // 5. Fresh device, recovery code only, and add its own passkey: identical holdings.
  const C = await newDevice(browser, 'C-fresh', 'desktop');
  await restoreAndEnter(C, code, true);
  expect(await holdings(C.page)).toEqual(before);

  // 6. Passkey devices still unlock against the restored server: the original phone (old cookies dropped)
  //    and the fresh device's new passkey.
  await A.context.clearCookies();
  await a.getByRole('button', { name: 'Lock', exact: true }).click();
  await passkeyUnlock(a);
  await syncNow(a);
  expect(await holdings(a)).toEqual(before);

  await C.page.getByRole('button', { name: 'Lock', exact: true }).click();
  await passkeyUnlock(C.page);
  await syncNow(C.page);
  expect(await holdings(C.page)).toEqual(before);

  await A.context.close();
  await C.context.close();
});
