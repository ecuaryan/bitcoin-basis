import { expect, test, type Page } from '@playwright/test';
import { expectNoViolations } from './helpers.ts';
import { FAKE_URL, goSecurity, readCode, setUp } from './fake.ts';

/** First run, unlock, restore, add a device and the emergency kit, against the test-only build (fake server and passkeys). */

async function lock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
}

test('setup: claim, passkey, recovery code once, confirm, done', async ({ page }) => {
  await page.goto(`${FAKE_URL}/`);
  await expect(page.getByText('Setup code', { exact: true })).toBeVisible();
  await expectNoViolations(page);

  await page.getByLabel('Setup code').fill('1234');
  await page.getByRole('button', { name: 'Claim and create my passkey' }).click();
  await expect(page.getByRole('alert')).toContainText('32 characters');

  await page.getByLabel('Setup code').fill('abcd 1234 abcd 1234 abcd 1234 abcd 1234');
  await page.getByRole('button', { name: 'Claim and create my passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
  await expect(page.getByText('This is NOT a Bitcoin seed phrase.')).toBeVisible();
  await expectNoViolations(page);
  const code = await readCode(page);
  expect(code).toMatch(/^([0-9A-Z]{5}-){5}[0-9A-Z]{5}$/);

  await page.getByRole('button', { name: "I've saved it" }).click();
  await expect(page.getByRole('heading', { name: 'Check your recovery code' })).toBeVisible();
  await expect(page).toHaveTitle('Check your recovery code · Bitcoin Basis');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.getByLabel('Group 4 of your recovery code').fill('AAAAA');
  await expect(page.getByText('That is not group 4')).toBeVisible();
  await expectNoViolations(page);
  await page.getByLabel('Group 4 of your recovery code').fill((code.split('-')[3] ?? '').toLowerCase());
  await expect(page.getByText('That matches.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Add my first wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await expectNoViolations(page);
});

test('the check can be skipped after a warning, and the code can be shown again', async ({ page }) => {
  await setUp(page, { finish: false });
  await page.getByRole('button', { name: "I've saved it" }).click();
  await page.getByRole('button', { name: 'Show the code again' }).click();
  await expect(page.getByRole('list', { name: 'Recovery code, six groups of five' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip this check' }).click();
  await expect(page.getByText("won't open your records")).toBeVisible();
  await page.getByRole('button', { name: 'Skip anyway' }).click();
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
});

test('lock, unlock with the passkey, and a calm reason when it locked itself', async ({ page }) => {
  await setUp(page);
  await lock(page);
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my recovery code instead' })).toBeVisible();
  await expect(page).toHaveTitle('Unlock · Bitcoin Basis');
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();

  // Locked by the idle timer: the reason is shown.
  await page.evaluate(() => window.__bbFake?.vault.lock('idle'));
  await expect(page.getByText(/Locked after 5 minutes/)).toBeVisible();
  await expectNoViolations(page);
});

test('unlock with the recovery code, with live checking', async ({ page }) => {
  const code = await setUp(page);
  await lock(page);
  await page.getByRole('button', { name: 'Use my recovery code instead' }).click();
  const field = page.getByLabel('Recovery code', { exact: true });
  await field.fill(code.replaceAll('-', '').slice(0, 8));
  await expect(page.getByText('8 of 30 characters')).toBeVisible();
  await field.fill('UUUUU');
  const flat = code.replaceAll('-', '');
  await field.fill(flat.slice(0, 29) + (flat.endsWith('2') ? '3' : '2'));
  await expect(page.getByText(/There is a typo/)).toBeVisible();
  await expectNoViolations(page);
  await field.fill(code.toLowerCase().replaceAll('-', ' '));
  await expect(page.getByText('This code looks right.')).toBeVisible();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
});

test('a new device: restore with the code, then add a passkey there', async ({ page }) => {
  const code = await setUp(page);
  // The fake build keeps everything in the page, so a reload would reset it: use in-app navigation instead.
  // A new device whose authenticator doesn't have the first passkey (it doesn't sync here).
  await page.evaluate(async () => {
    await window.__bbFake?.vault.forgetDevice();
    window.__bbFake?.auth.creds.splice(0);
  });
  // The server already holds records, so Welcome offers opening them, not claiming.
  await expect(page.getByRole('heading', { name: 'These records are already set up.' })).toBeVisible();
  await expect(page.getByLabel('Setup code')).toHaveCount(0);
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'I already use Bitcoin Basis' }).click();
  await expect(page.getByText('This is NOT a Bitcoin seed phrase.')).toBeVisible();
  await expectNoViolations(page);
  await page.getByLabel('Recovery code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Restore my records' }).click();
  await expect(page.getByRole('heading', { name: 'Records restored' })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Add a passkey on this device' }).click();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await lock(page);
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
});

test('a new device whose passkey already syncs there: restore with the code, and adding a passkey adopts it', async ({ page }) => {
  const code = await setUp(page);
  // Forgetting the device keeps the authenticator's passkey: it stands in for one synced from the other device.
  await page.evaluate(() => window.__bbFake?.vault.forgetDevice());
  await page.getByRole('button', { name: 'I already use Bitcoin Basis' }).click();
  await expect(page.getByRole('button', { name: 'Use my passkey' })).toBeVisible();
  await expect(page.getByText('usually work on your other devices too')).toBeVisible();
  await expectNoViolations(page);
  await page.getByLabel('Recovery code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Restore my records' }).click();
  await expect(page.getByRole('heading', { name: 'Records restored' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a passkey on this device' }).click();
  await expect(page.getByText('Your passkey from your other device works here too.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  // Adopted, never registered twice.
  expect(await page.evaluate(() => window.__bbFake?.server.creds.size)).toBe(1);
  expect(await page.evaluate(() => window.__bbFake?.vault.status.passkeyUnlock)).toBe(true);
  await lock(page);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
});

test('"Use my passkey" on a new device: nothing here, so it points to the recovery code', async ({ page }) => {
  await setUp(page);
  await page.evaluate(async () => {
    await window.__bbFake?.vault.forgetDevice();
    window.__bbFake?.auth.creds.splice(0);
  });
  await page.getByRole('button', { name: 'I already use Bitcoin Basis' }).click();
  await page.getByRole('button', { name: 'Use my passkey' }).click();
  await expect(page.getByRole('alert')).toHaveText('No passkey was used. If your passkey is not on this device, type your recovery code below.');
  await expect(page.getByLabel('Recovery code', { exact: true })).toBeFocused();
  await expectNoViolations(page);
});

test('opened from an older kit\'s QR link: restore, add the passkey, then make a new recovery code', async ({ page }) => {
  await page.goto(`${FAKE_URL}/?fake=kit-link`);
  // The code from the link is filled in.
  await expect(page.getByRole('button', { name: 'Restore my records' })).toBeEnabled();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Restore my records' }).click();
  await expect(page.getByRole('heading', { name: 'Records restored' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a passkey on this device' }).click();
  const offer = page.getByRole('dialog', { name: 'Make a new recovery code?' });
  await expect(offer).toContainText("You opened this from your kit's QR code.");
  await offer.getByRole('button', { name: 'Make a new code' }).click();
  const sheet = page.getByRole('dialog', { name: 'Make a new recovery code?' });
  await expect(sheet).toContainText('stops working');
  await sheet.getByRole('button', { name: 'Make a new code' }).click();
  await expect(page.getByRole('article', { name: 'Emergency kit' })).toBeVisible();
  expect(await page.evaluate(() => window.__bbFake?.server.epoch())).toBe(2);
});

test('opened from an older kit\'s QR link, passkey skipped: the new-code offer waits, and the sheet adds a passkey first', async ({ page }) => {
  await page.goto(`${FAKE_URL}/?fake=kit-link`);
  await page.getByRole('button', { name: 'Restore my records' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await goSecurity(page);
  await page.getByRole('button', { name: 'Make a new recovery code' }).click();
  const sheet = page.getByRole('dialog', { name: 'Make a new recovery code?' });
  await expect(sheet).toContainText('This device needs a passkey before it can make a new code.');
  await expectNoViolations(page);
  await sheet.getByRole('button', { name: 'Add a passkey on this device' }).click();
  await expect(sheet).toContainText('Your passkey from your other device works here too.');
  await sheet.getByRole('button', { name: 'Make a new code' }).click();
  await expect(page.getByRole('article', { name: 'Emergency kit' })).toBeVisible();
});

test('Settings, Security and devices: add a device QR, passkey, auto-lock, rotate, forget', async ({ page }) => {
  const code = await setUp(page);
  await goSecurity(page);
  await page.getByText('Show the address and square code').click();
  await expect(page.getByRole('img', { name: /QR code for 127\.0\.0\.1/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sync between devices' })).toContainText(/Up to date|Syncing/);
  await expectNoViolations(page);

  await page.getByLabel('Lock after').selectOption('15');
  expect(await page.evaluate(() => window.__bbFake?.vault.status.autoLockMinutes)).toBe(15);

  // Setup already made a passkey here, so there is nothing to add.
  await expect(page.getByText('Passkey on this device ✓')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a passkey on this device' })).toHaveCount(0);

  // Rotate: confirm first, then the new code appears on the kit; the old one stops working.
  await page.getByRole('button', { name: 'Make a new recovery code' }).click();
  await expect(page.getByRole('dialog', { name: 'Make a new recovery code?' })).toContainText('stops working');
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Make a new code' }).click();
  await expect(page.getByRole('article', { name: 'Emergency kit' })).toBeVisible();
  const slots = await page.getByRole('list', { name: 'Recovery code groups' }).locator('li').allInnerTexts();
  const fresh = slots.join('-');
  expect(fresh).not.toEqual(code);
  expect(fresh).toMatch(/^([0-9A-Z]{5}-){5}[0-9A-Z]{5}$/);
  await expectNoViolations(page);
});

test('the emergency kit prints right after setup, then only without the code', async ({ page }) => {
  const code = await setUp(page, { finish: false });
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  await page.getByRole('link', { name: 'Print the emergency kit' }).click();
  const paper = page.getByRole('article', { name: 'Emergency kit' });
  await expect(paper).toContainText('This app holds records, not Bitcoin.');
  // The square code only opens the app; the recovery code is never in a link.
  await expect(paper.getByRole('img', { name: 'QR code that opens the app address' })).toBeVisible();
  await expect(paper).not.toContainText('Test it once a year');
  await expect(paper).toContainText('NOT a Bitcoin seed phrase');
  await expect(paper).toContainText((code.split('-')[0] ?? ''));
  await page.getByLabel(/Your name, printed at the top/).fill('Alex Example');
  await expect(paper.getByRole('heading', { level: 1 })).toContainText('Alex Example');
  await expect(paper.getByRole('img', { name: 'QR code that opens the app address' })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  await expect(page.getByText('Print this page or save it as a PDF, then tap Back to finish setup.')).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
});

test('forget this device asks first, then goes back to Welcome', async ({ page }) => {
  await setUp(page);
  await goSecurity(page);
  await page.getByRole('button', { name: 'Forget this device' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Forget this device?' });
  await expect(dialog).toContainText('removes everything stored on this device');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Security and devices' })).toBeVisible();
  await page.getByRole('button', { name: 'Forget this device' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Forget this device' }).click();
  await expect(page.getByRole('heading', { name: /already set up/ })).toBeVisible();
});

test('sync indicator shows offline and a Connect button when signed out', async ({ page }) => {
  await setUp(page);
  // Synced: a labelled status on desktop, nothing on phones (a bare dot meant nothing to people).
  const synced = page.locator('a[aria-label^="Sync: Synced"]').first();
  await expect(synced).toBeAttached();
  if ((page.viewportSize()?.width ?? 0) < 1024) await expect(synced).toBeHidden();
  else await expect(synced).toBeVisible();
  await page.evaluate(() => {
    const f = window.__bbFake;
    if (f) f.client.offline = true;
  });
  await page.evaluate(() => window.__bbFake?.vault.sync());
  await expect(page.getByRole('link', { name: /^Sync: Offline/ }).first()).toBeAttached();
  await page.evaluate(() => {
    const f = window.__bbFake;
    if (f) {
      f.client.offline = false;
      f.client.expireSession();
    }
  });
  await page.evaluate(() => window.__bbFake?.vault.sync());
  await expect(page.getByRole('button', { name: 'Sign in to sync' }).first()).toBeVisible();
});

test('demo mode is labelled, never touches the vault, and has an exit', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('bb.hide', '0'));
  await page.goto(`${FAKE_URL}/`);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Demo — made-up data, gone when you close it')).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByRole('heading', { name: /on the record/ })).toBeVisible();
  expect(await page.evaluate(() => window.__bbFake?.vault.status.state)).toBe('empty');
});
