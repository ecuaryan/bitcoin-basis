/**
 * Unlock must never hang: a passkey prompt that never settles, a server that goes quiet, a logout
 * stuck in flight. Each case must end (abort, timeout or offline unlock) and leave the queue free.
 */
import { describe, expect, test } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { getAssertion, PasskeyError } from './passkey.ts';
import { FakeAuthenticator } from './test/fake-authenticator.ts';
import { FakeServer } from './test/fake-server.ts';
import { makeDevice, settle } from './test/harness.ts';
import type { UnlockStep } from './vault.ts';

const SETUP = 'setup-0123456789';
const BOOK = buildDemoBook().entries.slice(0, 12);

/** A device with the vault and some entries synced, then locked. Real-millisecond timeouts kept short. */
async function lockedDevice(opts: { apiTimeoutMs?: number; unlockNetworkMs?: number } = {}) {
  const server = new FakeServer(SETUP);
  const auth = new FakeAuthenticator('phone');
  const d = await makeDevice(server, auth, { apiTimeoutMs: opts.apiTimeoutMs ?? 60, unlockNetworkMs: opts.unlockNetworkMs ?? 40 });
  const { recoveryCode } = await d.vault.create({ setupCode: SETUP });
  await d.vault.store.append(BOOK);
  expect((await d.vault.sync()).ok).toBe(true);
  d.vault.lock('hidden');
  await settle();
  expect(d.vault.status.state).toBe('locked');
  return { server, auth, d, recoveryCode };
}

const stepsOf = () => {
  const steps: UnlockStep[] = [];
  return { steps, onStep: (s: UnlockStep) => steps.push(s) };
};

describe('a passkey prompt that never settles', () => {
  test('a second unlock aborts it, the queue is released, and the second one unlocks', async () => {
    const { auth, d } = await lockedDevice();
    auth.hangGets = 1;
    const gets = auth.calls.get;
    const first = d.vault.unlockWithPasskey();
    await settle();
    expect(auth.calls.get).toBe(gets + 1); // the hung prompt
    expect(d.vault.unlocking).toBe(true);
    const second = d.vault.unlockWithPasskey();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await expect(second).resolves.toMatchObject({ via: 'passkey' });
    expect(d.vault.status.state).toBe('unlocked');
    expect(d.vault.unlocking).toBe(false);
    expect(await d.vault.store.list()).toHaveLength(BOOK.length);
    // Every prompt was handed an abort signal; the abandoned one's fired.
    expect(auth.getSignals.every((s) => s instanceof AbortSignal)).toBe(true);
    expect(auth.getSignals.at(-2)?.aborted).toBe(true);
  });

  test('cancelUnlock (Try again) frees the queue for any other unlock', async () => {
    const { auth, d, recoveryCode } = await lockedDevice();
    auth.hangGets = 1;
    const first = d.vault.unlockWithPasskey();
    await settle();
    d.vault.cancelUnlock();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await expect(d.vault.unlockWithRecoveryCode(recoveryCode)).resolves.toMatchObject({ via: 'recovery' });
  });

  test("the caller's own signal aborts it too, and a late answer can't unlock afterwards", async () => {
    const { auth, d } = await lockedDevice();
    auth.hangGets = 1;
    const ctrl = new AbortController();
    const first = d.vault.unlockWithPasskey({ signal: ctrl.signal });
    await settle();
    ctrl.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await settle();
    expect(d.vault.status.state).toBe('locked');
    expect(d.vault.holdsKeyMaterial()).toBe(false);
  });

  test('the prompt backstop turns a silent prompt into a timeout', async () => {
    const auth = new FakeAuthenticator('x');
    auth.hangGets = 1;
    const err = await getAssertion(auth, { challenge: 'AAAA', userVerification: 'required' }, [], { backstopMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PasskeyError);
    expect(err).toMatchObject({ code: 'timeout' });
  });
});

describe('a server that is slow or goes quiet', () => {
  test('before the prompt: the device opens its local copy offline (PRF only), then skips the slow server for a while', async () => {
    const { auth, d, server } = await lockedDevice();
    d.client.hang = (p) => p.startsWith('/api/login/options');
    const { steps, onStep } = stepsOf();
    const gets = auth.calls.get;
    await expect(d.vault.unlockWithPasskey({ onStep })).resolves.toMatchObject({ via: 'passkey', sync: null });
    expect(steps).toEqual(['connecting', 'passkey', 'opening']);
    expect(auth.calls.get).toBe(gets + 1);
    expect(d.vault.status.state).toBe('unlocked');
    expect(await d.vault.store.list()).toHaveLength(BOOK.length);
    expect(server.requests.some((r) => r.path.startsWith('/api/login/verify'))).toBe(false);

    // Locked again right away: the server just timed out, so the prompt comes first, with no wait.
    d.vault.lock('user');
    const again = stepsOf();
    await d.vault.unlockWithPasskey({ onStep: again.onStep });
    expect(again.steps).toEqual(['passkey', 'opening']);

    // A while later the server is back: a normal sign-in.
    d.client.hang = null;
    d.vault.lock('user');
    d.scheduler.skip(61_000);
    const later = stepsOf();
    await d.vault.unlockWithPasskey({ onStep: later.onStep });
    expect(later.steps).toEqual(['connecting', 'passkey', 'signing-in', 'opening']);
  });

  test('after the prompt (sign-in check hangs): opens the local copy with the same prompt, no second prompt', async () => {
    const { auth, d } = await lockedDevice();
    d.client.hang = (p) => p.startsWith('/api/login/verify');
    const { steps, onStep } = stepsOf();
    const gets = auth.calls.get;
    await expect(d.vault.unlockWithPasskey({ onStep })).resolves.toMatchObject({ via: 'passkey' });
    expect(steps).toEqual(['connecting', 'passkey', 'signing-in', 'opening']);
    expect(auth.calls.get).toBe(gets + 1);
    expect(await d.vault.store.list()).toHaveLength(BOOK.length);
  });

  test('a 5xx at sign-in also falls back to the local copy', async () => {
    const { server, d } = await lockedDevice();
    server.failing.set('/api/login/options', 503);
    await expect(d.vault.unlockWithPasskey()).resolves.toMatchObject({ via: 'passkey' });
  });

  test('a logout stuck in flight (sent at lock) does not hold the unlock', async () => {
    const { d } = await lockedDevice({ apiTimeoutMs: 5_000, unlockNetworkMs: 30 });
    await d.vault.unlockWithPasskey();
    d.client.hang = (p) => p.startsWith('/api/logout');
    d.vault.lock('user'); // its logout never answers
    await expect(d.vault.unlockWithPasskey()).resolves.toMatchObject({ via: 'passkey' });
    expect(d.vault.status.state).toBe('unlocked');
  });

  test('the recovery code unlocks offline too when the server hangs', async () => {
    const { d, recoveryCode } = await lockedDevice();
    d.client.hang = () => true;
    const { steps, onStep } = stepsOf();
    await expect(d.vault.unlockWithRecoveryCode(recoveryCode, { onStep })).resolves.toMatchObject({ via: 'recovery' });
    expect(steps).toEqual(['signing-in', 'opening']);
    expect(await d.vault.store.list()).toHaveLength(BOOK.length);
  });

  test('a fresh device (nothing stored) gets a plain timeout error, never a hang', async () => {
    const { server, auth, recoveryCode } = await lockedDevice();
    const fresh = await makeDevice(server, auth, { apiTimeoutMs: 60, unlockNetworkMs: 40 });
    fresh.client.hang = () => true;
    await expect(fresh.vault.unlockWithPasskey()).rejects.toMatchObject({ code: 'timeout' });
    await expect(fresh.vault.unlockWithRecoveryCode(recoveryCode)).rejects.toMatchObject({ code: 'timeout' });
    expect(fresh.vault.unlocking).toBe(false);
  });

  test('a normal online unlock reports each step in order', async () => {
    const { d } = await lockedDevice();
    const { steps, onStep } = stepsOf();
    await d.vault.unlockWithPasskey({ onStep });
    expect(steps).toEqual(['connecting', 'passkey', 'signing-in', 'opening']);
    expect(d.vault.status.unlockedWith).toBe('passkey');
  });
});
