/**
 * An unlock that fails, is abandoned or is locked while it reads the local copy must leave no key
 * material behind, no server session open, and must never wipe a newer unlock that took over.
 * (Security review 4: `begin()` ran `store.start` before setting the session, so a failed local read
 * left the data keys in the store while the app showed the lock screen, and `lock()` returned early.)
 */
import { describe, expect, test } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import type { Entry } from '@bitcoin-basis/engine';
import type { BroadcastLike } from './env.ts';
import { VaultError } from './errors.ts';
import type { StoreName } from './idb.ts';
import { FakeAuthenticator } from './test/fake-authenticator.ts';
import { FakeServer } from './test/fake-server.ts';
import { makeDevice, settle } from './test/harness.ts';
import { AUTO_LOCK_FLUSH_MS } from './vault.ts';

const SETUP = 'setup-0123456789';
const BOOK = buildDemoBook().entries.slice(0, 5);

/** A channel the test can deliver a "changed" message on (as another tab would). */
function fakeChannel() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const channel: BroadcastLike = {
    postMessage: () => undefined,
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
  };
  return { channel, deliver: () => listeners.forEach((l) => l({ data: { type: 'changed' } } as MessageEvent)) };
}

type Entries = (s: StoreName) => Promise<[string, unknown][]>;

async function lockedDevice(extra: { channel?: BroadcastLike; beforeAutoLock?: () => Promise<void> } = {}) {
  const server = new FakeServer(SETUP);
  const auth = new FakeAuthenticator('phone');
  const d = await makeDevice(server, auth, { apiTimeoutMs: 60, unlockNetworkMs: 40, ...extra });
  await d.vault.create({ setupCode: SETUP });
  await d.vault.store.append(BOOK);
  expect((await d.vault.sync()).ok).toBe(true);
  d.vault.lock('user');
  await settle();
  expect(d.vault.holdsKeyMaterial()).toBe(false);
  const db = d.db as unknown as { entries: Entries };
  const real: Entries = db.entries.bind(db);
  return { server, d, db, real };
}

describe('a failed local read during unlock', () => {
  test('rejects, holds no keys, ends the sign-in, and a "changed" message cannot decrypt anything', async () => {
    const { channel, deliver } = fakeChannel();
    const { server, d, db, real } = await lockedDevice({ channel });
    const revoked = server.revoked.size;
    let failNext = true;
    db.entries = (s) => {
      if (s === 'outbox' && failNext) {
        failNext = false;
        return Promise.reject(new VaultError('storage-blocked', 'an IndexedDB transaction did not finish in time'));
      }
      return real(s);
    };

    await expect(d.vault.unlockWithPasskey()).rejects.toMatchObject({ code: 'storage-blocked' });
    await settle();
    expect(d.vault.status.state).toBe('locked');
    expect(d.vault.store.unlocked).toBe(false);
    expect(d.vault.holdsKeyMaterial()).toBe(false);
    // The attempt signed in before the read failed: that server session is ended, not left open.
    expect(server.revoked.size).toBe(revoked + 1);

    // Another tab says the local copy changed: nothing is decrypted while locked.
    deliver();
    await settle();
    expect(await d.vault.store.list()).toHaveLength(0);
    expect(d.vault.store.isLoaded()).toBe(false);

    // Lock is harmless, and the next unlock works.
    d.vault.lock('user');
    expect(d.vault.holdsKeyMaterial()).toBe(false);
    await expect(d.vault.unlockWithPasskey()).resolves.toMatchObject({ via: 'passkey' });
    expect(await d.vault.store.list()).toHaveLength(BOOK.length);
  });

  test('also on the offline path (no sign-in to end)', async () => {
    const { server, d, db, real } = await lockedDevice();
    d.client.offline = true;
    db.entries = (s) => (s === 'outbox' ? Promise.reject(new VaultError('storage-blocked')) : real(s));
    await expect(d.vault.unlockWithPasskey()).rejects.toMatchObject({ code: 'storage-blocked' });
    expect(d.vault.holdsKeyMaterial()).toBe(false);
    expect(server.revoked.size).toBe(1); // only the earlier lock's logout
  });

  test('the recovery-code path wipes its token and drops the keys', async () => {
    const server = new FakeServer(SETUP);
    const auth = new FakeAuthenticator('phone');
    const d = await makeDevice(server, auth, { apiTimeoutMs: 60, unlockNetworkMs: 40 });
    const { recoveryCode } = await d.vault.create({ setupCode: SETUP });
    d.vault.lock('user');
    await settle();
    const db = d.db as unknown as { entries: Entries };
    const real: Entries = db.entries.bind(db);
    db.entries = (s) => (s === 'blobs' ? Promise.reject(new VaultError('storage-blocked')) : real(s));
    await expect(d.vault.unlockWithRecoveryCode(recoveryCode)).rejects.toMatchObject({ code: 'storage-blocked' });
    expect(d.vault.holdsKeyMaterial()).toBe(false);
  });
});

describe('lock() while an unlock is reading the local copy', () => {
  test('drops the keys at once and ends the sign-in, though no session was open yet', async () => {
    const { server, d, db, real } = await lockedDevice();
    let release: () => void = () => undefined;
    let reached = false;
    db.entries = (s) => {
      if (s !== 'outbox') return real(s);
      reached = true;
      return new Promise((r) => (release = () => void real(s).then(r)));
    };
    const revoked = server.revoked.size;
    const unlocking = d.vault.unlockWithPasskey();
    for (let i = 0; i < 20 && !reached; i++) await settle();
    expect(reached).toBe(true);
    expect(d.vault.status.state).toBe('locked');
    expect(d.vault.holdsKeyMaterial()).toBe(true); // the store holds the keys while it reads

    d.vault.lock('user');
    expect(d.vault.holdsKeyMaterial()).toBe(false);
    await settle();
    expect(server.revoked.size).toBe(revoked + 1);

    release();
    await expect(unlocking).rejects.toMatchObject({ code: 'locked' });
    await settle();
    expect(d.vault.holdsKeyMaterial()).toBe(false);
    expect(await d.vault.store.list()).toHaveLength(0);
  });
});

describe('a stale unlock never wipes a newer one', () => {
  test('the abandoned attempt finishing its read late leaves the newer unlock open', async () => {
    const { d, db, real } = await lockedDevice();
    let release: () => void = () => undefined;
    let hang = true;
    let reached = false;
    db.entries = (s) => {
      if (s !== 'outbox' || !hang) return real(s);
      hang = false;
      reached = true;
      return new Promise((r) => (release = () => void real(s).then(r)));
    };
    const first = d.vault.unlockWithPasskey();
    for (let i = 0; i < 20 && !reached; i++) await settle();
    expect(reached).toBe(true);
    const second = d.vault.unlockWithPasskey(); // aborts the first
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await expect(second).resolves.toMatchObject({ via: 'passkey' });
    expect(await d.vault.store.list()).toHaveLength(BOOK.length);

    release(); // the first attempt's read comes back now
    await settle();
    expect(d.vault.status.state).toBe('unlocked');
    expect(d.vault.store.unlocked).toBe(true);
    expect(await d.vault.store.list()).toHaveLength(BOOK.length);
  });
});

describe('idle auto-lock', () => {
  test('finishes pending saves while the keys are still there, then locks', async () => {
    const extra: Entry[] = buildDemoBook().entries.slice(5, 6);
    const seen: boolean[] = [];
    let vaultRef: { holdsKeyMaterial(): boolean; store: { append(e: readonly Entry[]): Promise<void> } } | null = null;
    const { d } = await lockedDevice({
      beforeAutoLock: async () => {
        if (vaultRef === null) return;
        seen.push(vaultRef.holdsKeyMaterial());
        await vaultRef.store.append(extra);
      },
    });
    vaultRef = d.vault;
    await d.vault.unlockWithPasskey();
    await d.scheduler.advance(5 * 60_000 + 1);
    await settle();
    expect(seen).toEqual([true]);
    expect(d.vault.status.state).toBe('locked');
    expect(d.vault.status.lockReason).toBe('idle');
    expect(d.vault.holdsKeyMaterial()).toBe(false);
    vaultRef = null;
    await d.vault.unlockWithPasskey();
    expect((await d.vault.store.list()).map((e) => e.id)).toContain(extra[0]?.id);
  });

  test('a save that never finishes does not keep the vault open', async () => {
    const { d } = await lockedDevice({ beforeAutoLock: () => new Promise<void>(() => undefined) });
    await d.vault.unlockWithPasskey();
    await d.scheduler.advance(5 * 60_000 + 1);
    expect(d.vault.status.state).toBe('unlocked');
    await d.scheduler.advance(AUTO_LOCK_FLUSH_MS);
    expect(d.vault.status.state).toBe('locked');
    expect(d.vault.holdsKeyMaterial()).toBe(false);
  });
});
