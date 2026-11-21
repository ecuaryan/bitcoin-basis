// @vitest-environment happy-dom
import { act } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { incomingRecovery, recoveryLinkNotice } from '../../data/recovery-handoff.ts';
import { click, fire, type Rendered } from '../../test/render.tsx';
import { SETUP_CODE, renderWithVault } from '../../test/vault-fixture.tsx';
import { LinkHistoryPrompt } from '../../ui/LinkHistoryPrompt.tsx';
import { ToastProvider } from '../../ui/Toast.tsx';
import { FakeAuthenticator } from '../../vault/test/fake-authenticator.ts';
import { FakeServer } from '../../vault/test/fake-server.ts';
import { makeDevice, settle, type Device } from '../../vault/test/harness.ts';
import { Welcome } from './Welcome.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  recoveryLinkNotice.dismiss();
  incomingRecovery.take();
});

/** Records set up on another device ("the Mac"); returns a fresh, empty device ("the phone") and the code. */
async function claimed({ synced }: { synced: boolean }): Promise<{ server: FakeServer; phone: Device; phoneAuth: FakeAuthenticator; code: string }> {
  const server = new FakeServer(SETUP_CODE);
  const macAuth = new FakeAuthenticator('mac', { honorExclude: true });
  const mac = await makeDevice(server, macAuth);
  const { recoveryCode } = await mac.vault.create({ setupCode: SETUP_CODE });
  await settle();
  const phoneAuth = synced ? macAuth : new FakeAuthenticator('phone', { honorExclude: true });
  const phone = await makeDevice(server, phoneAuth);
  return { server, phone, phoneAuth, code: recoveryCode };
}

const tree = (
  <ToastProvider>
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route
        path="/"
        element={
          <>
            <p>HOLDINGS</p>
            <LinkHistoryPrompt />
          </>
        }
      />
      <Route path="/settings" element={<p>SETTINGS</p>} />
    </Routes>
  </ToastProvider>
);

const text = () => document.body.textContent ?? '';
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined;

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

async function openRestore(phone: Device): Promise<void> {
  app = await renderWithVault(tree, phone, { route: '/welcome' });
  await until(() => button('I already use Bitcoin Basis') !== undefined);
  await click(button('I already use Bitcoin Basis') as HTMLButtonElement);
}

async function typeCode(code: string): Promise<void> {
  const input = document.querySelector('input[name="password"]') as HTMLInputElement;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, code);
  });
  await fire(input, 'input');
  await until(() => button('Restore my records')?.disabled === false);
}

describe('Open your records', () => {
  it('leads with the passkey, explains where passkeys sync, and keeps the code as the alternative', async () => {
    const { phone } = await claimed({ synced: true });
    await openRestore(phone);
    const primary = button('Use my passkey');
    expect(primary).toBeDefined();
    expect(primary?.className).toContain('bg-accent');
    expect(text()).toContain('Passkeys saved in Google Password Manager, iCloud Keychain or a password manager like 1Password usually work on your other devices too.');
    expect(button('Restore my records')?.className).not.toContain('bg-accent');
    // The passkey from the Mac is here: one prompt and the records open.
    await click(primary as HTMLButtonElement);
    await until(() => text().includes('HOLDINGS'));
    expect(phone.vault.status).toMatchObject({ state: 'unlocked', passkeyUnlock: true });
  });

  it('when no passkey comes up, falls back to the code field with a helpful line', async () => {
    const { phone } = await claimed({ synced: false });
    await openRestore(phone);
    await click(button('Use my passkey') as HTMLButtonElement);
    await until(() => document.querySelector('[role="alert"]') !== null);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('No passkey was used. If your passkey is not on this device, type your recovery code below.');
    expect(document.activeElement).toBe(document.querySelector('input[name="password"]'));
    expect(phone.vault.status.state).toBe('empty');
  });
});

describe('after restoring with the code', () => {
  it('adding a passkey when the synced one is already here adopts it', async () => {
    const { server, phone, code } = await claimed({ synced: true });
    await openRestore(phone);
    await typeCode(code);
    await click(button('Restore my records') as HTMLButtonElement);
    await until(() => text().includes('Records restored'));
    await click(button('Add a passkey on this device') as HTMLButtonElement);
    await until(() => text().includes('HOLDINGS'));
    expect(text()).toContain('Your passkey from your other device works here too.');
    expect(server.creds.size).toBe(1);
    expect(phone.vault.status.passkeyUnlock).toBe(true);
  });

  it('from the kit QR link: passkey first, then the offer of a new code', async () => {
    const { phone, code } = await claimed({ synced: true });
    incomingRecovery.set(code);
    app = await renderWithVault(tree, phone, { route: '/welcome' });
    // The code is filled in, so restoring with it is the main button here.
    await until(() => button('Restore my records')?.disabled === false);
    expect(button('Restore my records')?.className).toContain('bg-accent');
    await click(button('Restore my records') as HTMLButtonElement);
    await until(() => text().includes('Records restored'));
    // Not yet: this device can't make a new code without a passkey.
    expect(text()).not.toContain('Make a new recovery code?');
    await click(button('Add a passkey on this device') as HTMLButtonElement);
    await until(() => text().includes('HOLDINGS'));
    await until(() => text().includes("You opened this from your kit's QR code."));
    await click(button('Make a new code') as HTMLButtonElement);
    await until(() => text().includes('SETTINGS'));
  });

  it('skipping the passkey keeps the new-code offer waiting until a passkey is added', async () => {
    const { phone, code } = await claimed({ synced: false });
    incomingRecovery.set(code);
    app = await renderWithVault(tree, phone, { route: '/welcome' });
    await until(() => button('Restore my records')?.disabled === false);
    await click(button('Restore my records') as HTMLButtonElement);
    await until(() => text().includes('Records restored'));
    await click(button('Not now') as HTMLButtonElement);
    await until(() => text().includes('HOLDINGS'));
    expect(text()).not.toContain('Make a new recovery code?');
    expect(recoveryLinkNotice.pending()).toBe(true);
    await act(async () => {
      await phone.vault.addPasskey();
      await settle();
    });
    await until(() => text().includes('Make a new recovery code?'));
  });
});
