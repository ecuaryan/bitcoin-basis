import { expect, test } from '@playwright/test';
import { expectNoViolations } from './helpers.ts';
import { goSecurity, readCode, setUp } from './fake.ts';

/** Saving the recovery code: password manager, copy, share. Test-only build. */

test('save, copy and share sit under the code card and work', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    Object.defineProperty(navigator, 'share', { value: (d: unknown) => ((window as unknown as { shared: unknown[] }).shared.push(d), Promise.resolve()), configurable: true });
    (window as unknown as { stored: unknown[] }).stored = [];
    Object.defineProperty(navigator, 'credentials', {
      value: { store: (c: { id: string; password: string }) => ((window as unknown as { stored: unknown[] }).stored.push({ id: c.id, password: c.password }), Promise.resolve()) },
      configurable: true,
    });
  });
  await setUp(page, { finish: false });
  const code = await readCode(page);

  const save = page.getByRole('button', { name: 'Save to password manager' });
  const copy = page.getByRole('button', { name: 'Copy', exact: true });
  const share = page.getByRole('button', { name: 'Share', exact: true });
  for (const b of [save, copy, share]) {
    await expect(b).toBeVisible();
    expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByText('Password managers keep it encrypted and synced.')).toBeVisible();
  // Order: code card, buttons, Print.
  const y = async (loc: ReturnType<typeof page.locator>) => (await loc.boundingBox())?.y ?? 0;
  expect(await y(page.getByRole('region', { name: 'Recovery code' }))).toBeLessThan(await y(save));
  expect(await y(save)).toBeLessThan(await y(page.getByRole('link', { name: 'Print the emergency kit' })));
  await expectNoViolations(page);

  await save.click();
  await expect(page.getByText('Saved, if your password manager asked.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { stored: unknown[] }).stored)).toEqual([{ id: 'Bitcoin Basis recovery code', password: code }]);

  await copy.click();
  await expect(page.getByText('Copied. Paste it somewhere safe.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  await share.click();
  expect(await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([{ title: 'Bitcoin Basis recovery code', text: code }]);
});

test('without Credential Management the hidden form is submitted, and Share is hidden without navigator.share', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'PasswordCredential', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await setUp(page, { finish: false });
  const code = await readCode(page);
  await page.evaluate(() => {
    document.addEventListener('submit', (e) => ((window as unknown as { submitted: unknown }).submitted = { user: (e.target as HTMLFormElement).elements.namedItem('username') && ((e.target as HTMLFormElement).elements.namedItem('username') as HTMLInputElement).value, pw: ((e.target as HTMLFormElement).elements.namedItem('password') as HTMLInputElement).value }));
  });
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  const url = page.url();
  await page.getByRole('button', { name: 'Save to password manager' }).click();
  await expect(page.getByText('Saved, if your password manager asked.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { submitted: unknown }).submitted)).toEqual({ user: 'Bitcoin Basis recovery code', pw: code });
  expect(page.url()).toBe(url);
  await expectNoViolations(page);
});

test('the new-code kit offers the buttons on screen but not on paper', async ({ page }) => {
  await setUp(page);
  await goSecurity(page);
  await page.getByRole('button', { name: 'Make a new recovery code' }).click();
  await page.getByRole('button', { name: 'Make a new code' }).click();
  await expect(page.getByRole('article', { name: 'Emergency kit' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save to password manager' });
  await expect(save).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await expectNoViolations(page);
  await page.emulateMedia({ media: 'print' });
  await expect(save).toBeHidden();
});

test('a code filled in by a password manager (with dashes, or pasted lower-case) is accepted', async ({ page }) => {
  const code = await setUp(page);
  await page.evaluate(() => window.__bbFake?.vault.forgetDevice());
  await page.getByRole('button', { name: 'Open my records' }).click();
  const field = page.getByLabel('Recovery code', { exact: true });
  await expect(field).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('form input[autocomplete="username"]')).toHaveValue('Bitcoin Basis recovery code');
  await field.fill(code.toLowerCase());
  await expect(page.getByText('This code looks right.')).toBeVisible();
  await expectNoViolations(page);
});
