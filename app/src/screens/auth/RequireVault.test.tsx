// @vitest-environment happy-dom
import { act } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAuthenticator } from '../../vault/test/fake-authenticator.ts';
import { FakeServer } from '../../vault/test/fake-server.ts';
import { makeDevice, settle } from '../../vault/test/harness.ts';
import { deviceWithVault, renderWithVault, restoredLockedDevice } from '../../test/vault-fixture.tsx';
import type { Rendered } from '../../test/render.tsx';
import { currentPlatform } from '../../data/platform.ts';
import { RequireVault } from './RequireVault.tsx';
import { Unlock } from './Unlock.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

const tree = (
  <Routes>
    <Route path="/welcome" element={<p>WELCOME PAGE</p>} />
    <Route
      path="*"
      element={
        <RequireVault>
          <p>THE APP</p>
        </RequireVault>
      }
    />
  </Routes>
);

describe('route guard', () => {
  it('no vault on this device: Welcome', async () => {
    const device = await makeDevice(new FakeServer('x'), new FakeAuthenticator('a'));
    app = await renderWithVault(tree, device, { route: '/records' });
    expect(app.container.textContent).toContain('WELCOME PAGE');
  });

  it('vault locked: Unlock, in place', async () => {
    const { device } = await deviceWithVault('locked');
    app = await renderWithVault(tree, device, { route: '/records' });
    expect(app.container.textContent).toContain('Your records are encrypted on this device');
    expect(app.container.textContent).not.toContain('THE APP');
  });

  it('vault unlocked: the app, and locking brings Unlock back', async () => {
    const { device } = await deviceWithVault('unlocked');
    app = await renderWithVault(tree, device);
    expect(app.container.textContent).toContain('THE APP');
    await act(async () => {
      device.vault.lock();
      await settle();
    });
    expect(app.container.textContent).not.toContain('THE APP');
    expect(app.container.textContent).toContain('Your records are encrypted on this device');
  });

  it('demo mode with no vault: the app (and the demo flag is ignored once a vault exists)', async () => {
    const empty = await makeDevice(new FakeServer('x'), new FakeAuthenticator('a'));
    app = await renderWithVault(tree, empty, { demo: true });
    expect(app.container.textContent).toContain('THE APP');
    app.unmount();
    const { device } = await deviceWithVault('locked');
    app = await renderWithVault(tree, device, { demo: true });
    expect(app.container.textContent).not.toContain('THE APP');
    window.localStorage.removeItem('bb.demo');
  });
});

describe('Unlock', () => {
  const label = () => document.querySelector('button')?.textContent ?? '';

  it.each([
    ['android', 'Unlock with fingerprint or screen lock'],
    ['macos', 'Unlock with Touch ID'],
    ['ios', 'Unlock with Face ID'],
    ['windows', 'Unlock with passkey'],
    ['other', 'Unlock with passkey'],
  ] as const)('on %s the button says %s', async (platform, text) => {
    const { device } = await deviceWithVault('locked');
    app = await renderWithVault(<Unlock platform={platform} />, device);
    expect(label()).toBe(text);
    expect(app.container.textContent).toContain('Use recovery code');
    if (platform !== 'ios') expect(app.container.textContent).not.toContain('Face ID');
  });

  it('on Android neither Face ID nor Touch ID appears anywhere', async () => {
    const { device } = await deviceWithVault('locked');
    app = await renderWithVault(<Unlock platform="android" />, device);
    expect(app.container.textContent).not.toMatch(/Face ID|Touch ID/);
  });

  it('a device without a passkey shows only the recovery code, with a reason', async () => {
    const { device, server, code } = await deviceWithVault('unlocked');
    const other = await restoredLockedDevice(server, code);
    expect(other.vault.status.passkeyUnlock).toBe(false);
    app = await renderWithVault(<Unlock platform="macos" />, other);
    const text = app.container.textContent ?? '';
    expect(text).toContain('has no passkey for these records yet');
    expect(text).not.toContain('Unlock with Touch ID');
    expect(app.container.querySelector('input')).not.toBeNull();
    expect(device.vault.status.state).toBe('unlocked');
  });

  it('says gently why it locked itself', async () => {
    const { device } = await deviceWithVault('unlocked');
    device.vault.lock('idle');
    app = await renderWithVault(<Unlock platform="android" />, device);
    expect(app.container.textContent).toContain('Locked after 5 minutes of no activity.');
    app.unmount();
    const second = (await deviceWithVault('unlocked')).device;
    second.vault.lock('hidden');
    app = await renderWithVault(<Unlock platform="android" />, second);
    expect(app.container.textContent).toContain('Locked while the app was in the background.');
  });

  it('currentPlatform reads this browser', () => {
    expect(['android', 'ios', 'macos', 'windows', 'other']).toContain(currentPlatform());
  });
});
