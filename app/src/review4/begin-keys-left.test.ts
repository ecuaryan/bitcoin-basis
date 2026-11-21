/**
 * Review 4 PoC: `Vault.begin()` now runs `store.start(keys)` BEFORE setting `session`. If the local read fails
 * (IndexedDB `storage-blocked` after the 30 s transaction backstop, a connection closed by another window that
 * cannot reopen, ...), begin() rejects without `store.stop()`. The store keeps the data keys, status says
 * "locked", and `lock()` returns early (session === null), so neither Lock nor auto-lock wipes them.
 */
import { describe, expect, test } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { VaultError } from '../vault/errors.ts';
import { FakeAuthenticator } from '../vault/test/fake-authenticator.ts';
import { FakeServer } from '../vault/test/fake-server.ts';
import { makeDevice, settle } from '../vault/test/harness.ts';

const SETUP = 'setup-0123456789';

describe('review4: a failed local read during unlock leaves key material behind', () => {
  test('store.start throws -> state "locked" but keys still held; lock() does not clear them', async () => {
    const server = new FakeServer(SETUP);
    const auth = new FakeAuthenticator('phone');
    const d = await makeDevice(server, auth, { apiTimeoutMs: 60, unlockNetworkMs: 40 });
    await d.vault.create({ setupCode: SETUP });
    await d.vault.store.append(buildDemoBook().entries.slice(0, 5));
    expect((await d.vault.sync()).ok).toBe(true);
    d.vault.lock('user');
    await settle();
    expect(d.vault.holdsKeyMaterial()).toBe(false);

    // The next read of the outbox fails the way a stuck/closed IndexedDB does.
    const db = d.db as unknown as { entries: (s: string) => Promise<unknown> };
    const real = db.entries.bind(db);
    let failNext = true;
    db.entries = (s: string) => {
      if (s === 'outbox' && failNext) {
        failNext = false;
        return Promise.reject(new VaultError('storage-blocked', 'an IndexedDB transaction did not finish in time'));
      }
      return real(s);
    };

    await expect(d.vault.unlockWithPasskey()).rejects.toMatchObject({ code: 'storage-blocked' });
    expect(d.vault.status.state).toBe('locked');
    // The data keys are still in memory although the app shows the lock screen...
    expect(d.vault.store.unlocked).toBe(true);
    expect(d.vault.holdsKeyMaterial()).toBe(true);
    // ...and Lock (or the idle/hidden auto-lock, which also calls lock()) cannot remove them.
    d.vault.lock('user');
    await settle();
    expect(d.vault.holdsKeyMaterial()).toBe(true);
  });
});
