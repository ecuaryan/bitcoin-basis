// @vitest-environment happy-dom
import { act } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { recoveryLinkNotice } from '../../data/recovery-handoff.ts';
import { click, type Rendered } from '../../test/render.tsx';
import { SETUP_CODE, renderWithVault } from '../../test/vault-fixture.tsx';
import { ToastProvider } from '../../ui/Toast.tsx';
import { FakeAuthenticator } from '../../vault/test/fake-authenticator.ts';
import { FakeServer } from '../../vault/test/fake-server.ts';
import { makeDevice, settle, type Device } from '../../vault/test/harness.ts';
import { SecurityView } from './records-security.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  recoveryLinkNotice.dismiss();
});

/** Device A set up with a passkey; device B restored with the recovery code (no passkey of its own yet). */
async function twoDevices({ synced }: { synced: boolean }): Promise<{ server: FakeServer; a: Device; b: Device; bAuth: FakeAuthenticator }> {
  const server = new FakeServer(SETUP_CODE);
  const aAuth = new FakeAuthenticator('mac', { honorExclude: true });
  const a = await makeDevice(server, aAuth);
  const { recoveryCode } = await a.vault.create({ setupCode: SETUP_CODE });
  // Synced: the phone's password manager already holds the Mac's passkey.
  const bAuth = synced ? aAuth : new FakeAuthenticator('phone', { honorExclude: true });
  const b = await makeDevice(server, bAuth);
  await b.vault.unlockWithRecoveryCode(recoveryCode);
  await settle();
  return { server, a, b, bAuth };
}

const tree = (
  <ToastProvider>
    <Routes>
      <Route path="/settings" element={<SecurityView />} />
      <Route path="/kit" element={<p>THE KIT</p>} />
    </Routes>
  </ToastProvider>
);

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const inDialog = (name: string) => [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name) as HTMLButtonElement | undefined;

async function until(check: () => boolean): Promise<void> {
  // Real crypto and IndexedDB work runs here: wait by time (slow CI runners), not by a count of ticks.
  const deadline = Date.now() + 10_000;
  while (!check() && Date.now() < deadline) {
    await act(async () => {
      await settle();
    });
  }
  expect(check()).toBe(true);
}

describe('the new-recovery-code sheet', () => {
  it('with no passkey here: says so in one line and offers to add one, then goes on to the new code', async () => {
    const { b } = await twoDevices({ synced: false });
    app = await renderWithVault(tree, b, { route: '/settings?rotate=1' });
    expect(dialog()?.textContent).toContain('This device needs a passkey before it can make a new code.');
    expect(inDialog('Make a new code')).toBeUndefined();
    await click(inDialog('Add a passkey on this device') as HTMLButtonElement);
    await until(() => inDialog('Make a new code') !== undefined);
    expect(dialog()?.textContent).toContain('Passkey added on this device.');
    expect(b.vault.status.passkeyUnlock).toBe(true);
    await click(inDialog('Make a new code') as HTMLButtonElement);
    await until(() => document.body.textContent?.includes('THE KIT') === true);
  });

  it('adopts a passkey synced from the other device instead of making a second one', async () => {
    const { server, b } = await twoDevices({ synced: true });
    app = await renderWithVault(tree, b, { route: '/settings?rotate=1' });
    await click(inDialog('Add a passkey on this device') as HTMLButtonElement);
    await until(() => inDialog('Make a new code') !== undefined);
    expect(dialog()?.textContent).toContain('Your passkey from your other device works here too.');
    expect(server.creds.size).toBe(1);
  });

  it('shows errors inside the sheet, not behind it', async () => {
    const { b, bAuth } = await twoDevices({ synced: true });
    app = await renderWithVault(tree, b, { route: '/settings?rotate=1' });
    bAuth.cancelNext = true;
    await click(inDialog('Add a passkey on this device') as HTMLButtonElement);
    await until(() => dialog()?.querySelector('[role="alert"]') !== null);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('Cancelled. Tap to try again.');

    // Now with a passkey: a refused rotation also reports inside the sheet.
    await click(inDialog('Add a passkey on this device') as HTMLButtonElement);
    await until(() => inDialog('Make a new code') !== undefined);
    bAuth.cancelNext = true;
    await click(inDialog('Make a new code') as HTMLButtonElement);
    await until(() => dialog()?.querySelector('[role="alert"]') !== null);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('Cancelled. Tap to try again.');
    // The page-level banner behind the sheet stays empty.
    expect([...document.querySelectorAll('[role="alert"]')].filter((el) => dialog()?.contains(el) !== true)).toEqual([]);
  });

  it('with a passkey here: the usual confirmation', async () => {
    const { a } = await twoDevices({ synced: false });
    app = await renderWithVault(tree, a, { route: '/settings?rotate=1' });
    expect(dialog()?.textContent).toContain('Your current kit stops working the moment this finishes.');
    expect(inDialog('Add a passkey on this device')).toBeUndefined();
    expect(inDialog('Make a new code')).toBeDefined();
  });
});

describe('Add another device', () => {
  it('says to use the passkey if it syncs, otherwise the recovery code', async () => {
    const { a } = await twoDevices({ synced: false });
    app = await renderWithVault(tree, a, { route: '/settings' });
    expect(document.body.textContent).toContain('Use your passkey if it syncs; otherwise type your recovery code.');
  });
});
