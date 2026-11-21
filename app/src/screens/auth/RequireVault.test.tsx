// @vitest-environment happy-dom
import { act } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAuthenticator } from '../../vault/test/fake-authenticator.ts';
import { FakeServer } from '../../vault/test/fake-server.ts';
import { makeDevice, settle } from '../../vault/test/harness.ts';
import { SETUP_CODE, deviceWithVault, renderWithVault, restoredLockedDevice } from '../../test/vault-fixture.tsx';
import { click, type Rendered } from '../../test/render.tsx';
import { PasskeyError } from '../../vault/passkey.ts';
import { currentPlatform } from '../../data/platform.ts';
import { RequireVault } from './RequireVault.tsx';
import { SLOW_AFTER_MS, Unlock, resetAutoPrompt, shouldAutoPrompt } from './Unlock.tsx';
import type { UnlockOptions, UnlockResult } from '../../vault/index.ts';

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
  });
});

describe('Unlock', () => {
  beforeEach(() => {
    resetAutoPrompt();
    // happy-dom never has focus; a real visible, focused page does.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const label = () => document.querySelector('button')?.textContent ?? '';

  it.each([
    ['android', 'Fingerprint or screen lock'],
    ['macos', 'Touch ID or password'],
    ['ios', 'Face ID or passcode'],
    ['windows', 'Passkey on this device'],
    ['other', 'Passkey on this device'],
  ] as const)('on %s the button says Unlock and the line under it says %s', async (platform, text) => {
    const { device } = await deviceWithVault('locked');
    app = await renderWithVault(<Unlock platform={platform} />, device);
    expect(label()).toBe('Unlock');
    expect(app.container.textContent).toContain(text);
    expect(app.container.textContent).toContain('Use my recovery code instead');
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
    expect(text).not.toContain('Touch ID');
    expect(app.container.querySelector('input')).not.toBeNull();
    await vi.waitFor(() => expect(device.vault.status.state).toBe('unlocked'), { timeout: 5000 });
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

  /** A page reload: a new Vault on the same stored data, locked, with nobody having pressed Lock. */
  async function reloaded() {
    return (await reloadedWithAuth()).device;
  }
  async function reloadedWithAuth() {
    const server = new FakeServer(SETUP_CODE);
    const auth = new FakeAuthenticator('test');
    const first = await makeDevice(server, auth);
    await first.vault.create({ setupCode: SETUP_CODE });
    await settle();
    const device = await makeDevice(server, auth, { db: first.db });
    expect(device.vault.status.lockReason).toBeNull();
    return { device, auth };
  }

  /** Let the automatic prompt start (it waits one timer tick) and its promise chains run. */
  const arrive = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 5));
      await settle();
    });

  /** An unlock that reports `step` and then waits until it is aborted. */
  function pending(step: 'passkey' | 'signing-in') {
    const signals: AbortSignal[] = [];
    const fn = (o: UnlockOptions = {}): Promise<UnlockResult> => {
      o.onStep?.(step);
      if (o.signal !== undefined) signals.push(o.signal);
      return new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'VaultError', code: 'aborted' }))));
    };
    return { fn, signals };
  }

  it('does not prompt by itself while the page is hidden or not focused (a home-screen app still launching)', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const device = await reloaded();
    let asked = 0;
    device.vault.unlockWithPasskey = () => {
      asked += 1;
      return Promise.reject(new PasskeyError('cancelled'));
    };
    app = await renderWithVault(<Unlock platform="android" />, device);
    await arrive();
    expect(asked).toBe(0);
    expect(label()).toBe('Unlock');
  });

  it('an automatic prompt the phone never shows: the button stays live, a tap starts over and unlocks', async () => {
    const { device, auth } = await reloadedWithAuth();
    auth.hangGets = 1;
    app = await renderWithVault(<Unlock platform="android" />, device);
    await arrive();
    expect(auth.calls.get).toBeGreaterThan(0);
    expect(label()).toBe('Waiting for your fingerprint…');
    const button = document.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await click(button);
    // Unlocking runs real WebCrypto, which can take longer than one settle on a slow CI machine.
    await vi.waitFor(() => expect(device.vault.status.state).toBe('unlocked'), { timeout: 5000 });
    await act(settle);
    expect(auth.getSignals[0]?.aborted).toBe(true);
    expect(app.container.querySelector('[role=alert]')).toBeNull();
  });

  it('shows each step on the button; after signing in starts, the button waits', async () => {
    const { device } = await deviceWithVault('locked');
    const p = pending('signing-in');
    device.vault.unlockWithPasskey = p.fn;
    app = await renderWithVault(<Unlock platform="android" />, device);
    await click(document.querySelector('button') as HTMLButtonElement);
    expect(label()).toBe('Signing in…');
    expect((document.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('after 20 s on one step: "Taking too long? Try again" aborts and resets', async () => {
    const { device } = await deviceWithVault('locked');
    const p = pending('signing-in');
    device.vault.unlockWithPasskey = p.fn;
    app = await renderWithVault(<Unlock platform="macos" />, device);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await click(document.querySelector('button') as HTMLButtonElement);
    const tryAgain = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Taking too long? Try again');
    await act(async () => {
      vi.advanceTimersByTime(SLOW_AFTER_MS - 1000);
    });
    expect(tryAgain()).toBeUndefined();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(tryAgain()).toBeDefined();
    await click(tryAgain() as HTMLButtonElement);
    expect(p.signals[0]?.aborted).toBe(true);
    expect(label()).toBe('Unlock');
    expect(tryAgain()).toBeUndefined();
    expect(app.container.querySelector('[role=alert]')).toBeNull();
  });

  it('a server that is slow before the prompt: the phone still unlocks offline with its local copy', async () => {
    const { device } = await deviceWithVault('locked');
    // Short real timeouts would need a rebuilt device; the vault's own tests cover the timing. Here: offline.
    device.client.offline = true;
    app = await renderWithVault(<Unlock platform="android" />, device);
    await click(document.querySelector('button') as HTMLButtonElement);
    await act(settle);
    await vi.waitFor(() => expect(device.vault.status.state).toBe('unlocked'), { timeout: 5000 });
  });

  it('asks for the passkey by itself once after a fresh load, never again', async () => {
    const device = await reloaded();
    let asked = 0;
    const real = device.vault.unlockWithPasskey.bind(device.vault);
    device.vault.unlockWithPasskey = () => {
      asked += 1;
      return real();
    };
    app = await renderWithVault(<Unlock platform="android" />, device);
    await arrive();
    expect(asked).toBe(1);
    app.unmount();
    const d2 = await reloaded();
    let asked2 = 0;
    d2.vault.unlockWithPasskey = () => {
      asked2 += 1;
      return Promise.reject(new PasskeyError('cancelled'));
    };
    app = await renderWithVault(<Unlock platform="android" />, d2);
    await arrive();
    expect(asked2).toBe(0); // already tried in this page session
  });

  it('a refused automatic prompt falls back silently to the button', async () => {
    const device = await reloaded();
    device.vault.unlockWithPasskey = () => Promise.reject(new PasskeyError('cancelled'));
    app = await renderWithVault(<Unlock platform="android" />, device);
    await arrive();
    expect(label()).toBe('Unlock');
    expect(app.container.querySelector('[role=alert]')).toBeNull();
  });

  it('does not prompt by itself after an explicit Lock', async () => {
    const { device } = await deviceWithVault('locked');
    let asked = 0;
    device.vault.unlockWithPasskey = () => {
      asked += 1;
      return Promise.reject(new PasskeyError('cancelled'));
    };
    app = await renderWithVault(<Unlock platform="android" />, device);
    await arrive();
    expect(asked).toBe(0);
  });

  it('never prompts by itself after Lock or an idle lock', () => {
    const o = { passkeyOk: true, lockReason: null, used: false, showingPasskey: true, visible: true, focused: true } as const;
    expect(shouldAutoPrompt(o)).toBe(true);
    expect(shouldAutoPrompt({ ...o, visible: false })).toBe(false);
    expect(shouldAutoPrompt({ ...o, focused: false })).toBe(false);
    expect(shouldAutoPrompt({ ...o, lockReason: 'user' })).toBe(false);
    expect(shouldAutoPrompt({ ...o, lockReason: 'idle' })).toBe(false);
    expect(shouldAutoPrompt({ ...o, lockReason: 'hidden' })).toBe(false);
    expect(shouldAutoPrompt({ ...o, used: true })).toBe(false);
    expect(shouldAutoPrompt({ ...o, passkeyOk: false })).toBe(false);
  });

  it('currentPlatform reads this browser', () => {
    expect(['android', 'ios', 'macos', 'windows', 'other']).toContain(currentPlatform());
  });
});
