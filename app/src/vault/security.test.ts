// Regression tests for the Step 3 security review (2026-11-20): recovery-code rotation really
// revokes the old code, sessions end on lock, and a lock during an unlock wins.
import type { Entry } from '@bitcoin-basis/engine';
import { describe, expect, test } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { fromBase64Url, toBase64Url } from './bytes.ts';
import { bindCredential, deriveRecoveryKek, generateCredentialKey, openHistory, unwrapDataKey, wrapAad } from './keys.ts';
import { RECORD_KEY, parseRecord } from './record.ts';
import { parseRecoveryCode } from './recovery-code.ts';
import { blobEpoch, openBlob, sealEntries } from './seal.ts';
import { FakeAuthenticator } from './test/fake-authenticator.ts';
import { FakeServer } from './test/fake-server.ts';
import { makeDevice, settle } from './test/harness.ts';

const SETUP = 'setup-0123456789';
const BOOK: readonly Entry[] = buildDemoBook().entries;

async function twoDevices() {
  const server = new FakeServer(SETUP);
  const phone = new FakeAuthenticator('phone');
  const a = await makeDevice(server, phone);
  const { recoveryCode: oldCode } = await a.vault.create({ setupCode: SETUP });
  await a.vault.store.append(BOOK.slice(0, 3));
  await a.vault.sync();
  // Device B (say, an old laptop) restored once with the code and keeps the v1 wrapping locally.
  const b = await makeDevice(server, null);
  await b.vault.unlockWithRecoveryCode(oldCode);
  b.vault.lock();
  // The kit leaks; the owner rotates on A.
  const { recoveryCode: newCode } = await a.vault.rotateRecoveryCode();
  return { server, phone, a, b, oldCode, newCode };
}

/** Everything an attacker can read with the OLD code plus a full copy of the server (or its backup). */
async function keysFromOldCode(server: FakeServer, oldCode: string): Promise<Map<number, CryptoKey>> {
  const vaultId = (server.claimed as { vaultId: string }).vaultId;
  const { secret } = await parseRecoveryCode(oldCode);
  const keys = new Map<number, CryptoKey>();
  // Try the old code against every recovery wrapping ever written (append-only: all still there).
  for (const [version, rec] of server.recovery) {
    const kek = await deriveRecoveryKek(secret, fromBase64Url(rec.salt));
    const dk = await unwrapDataKey(fromBase64Url(rec.wrappedDk), kek, wrapAad(vaultId, { type: 'recovery', version })).catch(() => null);
    if (dk === null) continue;
    keys.set(version, dk);
    const h = server.histories.get(version);
    if (h !== undefined) for (const [e, k] of await openHistory(fromBase64Url(h), dk, vaultId, version)) keys.set(e, k);
  }
  // Each history is sealed under its own epoch's key: open every one reachable with what we have.
  for (const [epoch, h] of server.histories) {
    const dk = keys.get(epoch);
    if (dk !== undefined) for (const [e, k] of await openHistory(fromBase64Url(h), dk, vaultId, epoch)) keys.set(e, k);
  }
  return keys;
}

async function readable(server: FakeServer, keys: Map<number, CryptoKey>, blobKeys: string[]): Promise<number> {
  const vaultId = (server.claimed as { vaultId: string }).vaultId;
  let n = 0;
  for (const k of blobKeys) {
    const blob = server.blobs.get(k) as Uint8Array;
    const dk = keys.get(blobEpoch(blob) ?? 0);
    if (dk !== undefined && (await openBlob(dk, vaultId, blob).then(() => true, () => false))) n++;
  }
  return n;
}

describe('recovery rotation revokes the old code', () => {
  test('old code + a full server copy cannot open any blob written after rotation (only what came before)', async () => {
    const { server, a, oldCode } = await twoDevices();
    const before = server.keys();
    await a.vault.store.append(BOOK.slice(3, 6));
    await a.vault.sync();
    const after = server.keys().filter((k) => !before.includes(k));
    expect(after.length).toBeGreaterThan(0);
    for (const k of after) expect(blobEpoch(server.blobs.get(k) as Uint8Array)).toBe(2);
    expect(server.recovery.get(1)).toBeDefined(); // the old wrapping is still on the server (append-only)

    const keys = await keysFromOldCode(server, oldCode);
    expect([...keys.keys()]).toEqual([1]);
    expect(await readable(server, keys, after)).toBe(0);
    // Documented limit: what was written before the rotation stays readable to the old code.
    expect(await readable(server, keys, before)).toBe(before.length);
  });

  test('the old code cannot sign in, and cannot unlock a device that still holds its wrapping (online)', async () => {
    const { server, b, oldCode, newCode } = await twoDevices();
    expect(parseRecord(await b.db.get('vault', RECORD_KEY))?.recovery?.version).toBe(1);
    await expect(b.vault.unlockWithRecoveryCode(oldCode)).rejects.toMatchObject({ code: 'wrong-recovery-code' });
    expect(b.vault.status.state).toBe('locked');
    // B dropped its copy of the old wrapping and says the code changed.
    expect(parseRecord(await b.db.get('vault', RECORD_KEY))?.recovery).toBeNull();
    expect(b.vault.status.recoveryCodeChanged).toBe(true);
    // Even offline now, the old code opens nothing on B.
    b.client.offline = true;
    await expect(b.vault.unlockWithRecoveryCode(oldCode)).rejects.toMatchObject({ code: 'offline' });
    b.client.offline = false;
    const fresh = await makeDevice(server, null);
    await expect(fresh.vault.unlockWithRecoveryCode(oldCode)).rejects.toMatchObject({ code: 'wrong-recovery-code' });
    expect(fresh.vault.status.state).toBe('empty');
    // The new code works on B and clears the notice.
    await b.vault.unlockWithRecoveryCode(newCode);
    expect(b.vault.status).toMatchObject({ state: 'unlocked', recoveryCodeChanged: false });
    expect(await b.vault.store.list()).toEqual(BOOK.slice(0, 3));
  });

  test('a device unlocked with the old code at rotation time loses its session and drops the wrapping on sync', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    const { recoveryCode } = await a.vault.create({ setupCode: SETUP });
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    await a.vault.rotateRecoveryCode();
    await a.vault.store.append(BOOK.slice(0, 2));
    await a.vault.sync();
    expect(await b.vault.sync()).toMatchObject({ ok: false, reason: 'signed-out' });
    expect(b.vault.status.recoveryCodeChanged).toBe(true);
    expect(await b.vault.store.list()).toEqual([]); // nothing after the rotation reached B
  });

  test('another passkey device picks up the new epoch on sync and re-seals its offline outbox', async () => {
    const { server, phone, a } = await twoDevices();
    // C: a fresh device with the synced passkey; it unlocks (at epoch 2), then goes offline.
    const c = await makeDevice(server, phone);
    await c.vault.unlockWithPasskey();
    expect(await c.vault.store.list()).toEqual(BOOK.slice(0, 3));
    // A rotates again while C is offline with an entry in its outbox, sealed under epoch 2.
    c.client.offline = true;
    await c.vault.store.append(BOOK.slice(6, 7));
    await settle();
    await a.vault.rotateRecoveryCode();
    await a.vault.store.append(BOOK.slice(7, 8));
    await a.vault.sync();
    c.client.offline = false;
    expect((await c.vault.sync()).ok).toBe(true);
    await c.vault.sync();
    await a.vault.sync();
    for (const k of server.keys()) expect([1, 2, 3]).toContain(blobEpoch(server.blobs.get(k) as Uint8Array));
    const newest = server.keys().slice(-2).map((k) => blobEpoch(server.blobs.get(k) as Uint8Array));
    expect(newest).toEqual([3, 3]);
    expect(new Set((await c.vault.store.list()).map((e) => e.id))).toEqual(new Set(BOOK.slice(0, 3).concat(BOOK.slice(6, 8)).map((e) => e.id)));
    expect(await a.vault.store.list()).toEqual(await c.vault.store.list());
    // C learned epoch 3 for its passkey: it now unlocks offline and reads everything.
    c.vault.lock();
    c.client.offline = true;
    await c.vault.unlockWithPasskey();
    expect(await c.vault.store.list()).toHaveLength(5);
  });

  test('rotation refuses to deliver the new key to a passkey record planted in storage', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    await a.vault.create({ setupCode: SETUP });
    const real = [...server.creds.values()][0];
    if (real === undefined) throw new Error('no credential');
    const planted = new Uint8Array(65);
    planted.set(fromBase64Url(real.credentialKey.publicKey));
    planted[64] = (planted[64] ?? 0) ^ 1;
    server.creds.set(toBase64Url(new Uint8Array(32).fill(7)), { ...real, credentialKey: { ...real.credentialKey, publicKey: toBase64Url(planted) } });
    await expect(a.vault.rotateRecoveryCode()).rejects.toMatchObject({ code: 'server' });
    expect(server.epoch()).toBe(1);
  });

  test('a device unlocked only with the recovery code cannot rotate; it can add a passkey with the code as proof', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    const { recoveryCode } = await a.vault.create({ setupCode: SETUP });
    const laptop = new FakeAuthenticator('laptop');
    const b = await makeDevice(server, laptop);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    await expect(b.vault.rotateRecoveryCode()).rejects.toMatchObject({ code: 'no-passkey' });
    const gets = laptop.calls.get;
    const { credentialId } = await b.vault.addPasskey();
    expect(laptop.calls.get).toBe(gets); // the code was the proof: no step-up prompt, just the create
    expect(server.creds.has(credentialId)).toBe(true);
    // Now it has a passkey: rotation works (one step-up prompt), and the new passkey got the new key.
    await b.vault.rotateRecoveryCode();
    expect(server.deliveries.has(`2/${credentialId}`)).toBe(true);
  });
});

describe('an old recovery code plus storage write access cannot get a later key', () => {
  /** The attacker's view: the leaked OLD code yields DK_1 from the server copy; they can write records directly. */
  async function attackerPlants(server: FakeServer, oldCode: string, claimEpoch: number) {
    const vaultId = (server.claimed as { vaultId: string }).vaultId;
    const keys = await keysFromOldCode(server, oldCode);
    const dk1 = keys.get(1);
    if (dk1 === undefined) throw new Error('old code should open epoch 1');
    const evil = await generateCredentialKey();
    const evilId = toBase64Url(new Uint8Array(32).fill(0xee));
    const binding = await bindCredential(dk1, vaultId, evilId, claimEpoch, evil.publicKey);
    const real = [...server.creds.values()][0];
    if (real === undefined) throw new Error('no credential');
    server.creds.set(evilId, { ...real, credentialKey: { publicKey: toBase64Url(evil.publicKey), wrappedPrivateKey: real.credentialKey.wrappedPrivateKey, epoch: claimEpoch, binding: toBase64Url(binding) } });
    return evilId;
  }

  test.each([
    ['its true epoch (1)', 1],
    ['the current epoch (2), bound with the old key', 2],
  ])('a passkey record planted after a rotation with a binding under the old key, claiming %s, gets nothing at the next rotation', async (_label, claimEpoch) => {
    const { server, a, oldCode } = await twoDevices();
    expect(server.epoch()).toBe(2);
    const evilId = await attackerPlants(server, oldCode, claimEpoch);
    await expect(a.vault.rotateRecoveryCode()).rejects.toMatchObject({ code: 'server' });
    expect(server.epoch()).toBe(2);
    expect([...server.deliveries.keys()].some((k) => k.endsWith(`/${evilId}`))).toBe(false);
  });

  test('legitimate passkeys are re-bound at every rotation, so rotations keep working', async () => {
    const { server, phone, a } = await twoDevices();
    const c = await makeDevice(server, phone);
    await c.vault.unlockWithPasskey();
    await c.vault.addPasskey(); // registered in epoch 2, bound under DK_2
    await a.vault.rotateRecoveryCode(); // epoch 3: re-binds both under DK_3
    await a.vault.rotateRecoveryCode(); // epoch 4: accepts only DK_3 bindings
    expect(server.epoch()).toBe(4);
    for (const id of server.creds.keys()) expect(server.deliveries.get(`4/${id}`)?.binding).toBeDefined();
  });
});

describe('sessions end on lock', () => {
  test('lock revokes the server session; offline, the logout is queued until back online', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    await a.vault.create({ setupCode: SETUP });
    const first = a.client.cookie as string;
    a.vault.lock();
    await settle();
    expect(server.revoked.has(first)).toBe(true);

    await a.vault.unlockWithPasskey();
    const second = a.client.cookie as string;
    a.client.offline = true;
    a.vault.lock();
    await settle();
    expect(server.revoked.has(second)).toBe(false);
    expect(parseRecord(await a.db.get('vault', RECORD_KEY))?.logoutPending).toBe(true);
    // A thief replaying the cookie still gets in until the device is back online...
    const thief = server.client();
    thief.setCookie(second);
    // ...and the next unlock sends the queued logout before signing in again.
    a.client.offline = false;
    await a.vault.unlockWithPasskey();
    expect(server.revoked.has(second)).toBe(true);
    expect(a.client.cookie).not.toBe(second);
    expect(parseRecord(await a.db.get('vault', RECORD_KEY))?.logoutPending).toBe(false);
    const res = await thief.fetch('/api/blobs', { method: 'GET', credentials: 'same-origin' });
    expect(res.status).toBe(401);
    expect((await a.vault.sync()).ok).toBe(true);
  });

  test('a stale session cookie cannot add a passkey without a fresh assertion', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    await a.vault.create({ setupCode: SETUP });
    const thief = server.client();
    thief.setCookie(a.client.cookie);
    const opts = await thief.fetch('/api/register/options', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(opts.status).toBe(200);
    const res = await thief.fetch('/api/register/verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: {}, challengeToken: 'x', prfSalt: toBase64Url(new Uint8Array(32)), credentialKey: { publicKey: toBase64Url(new Uint8Array(65)), binding: toBase64Url(new Uint8Array(28)), wrappedPrivateKey: 'x', epoch: 1 }, delivery: { epoch: 1, ephemeralPublicKey: toBase64Url(new Uint8Array(65)), wrappedDk: toBase64Url(new Uint8Array(60)) } }),
    });
    expect(res.status).toBe(401);
  });
});

describe('lock requests during an in-flight unlock', () => {
  test('lock() during a pending passkey unlock wins: the unlock fails and the vault stays locked', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    await a.vault.create({ setupCode: SETUP });
    a.vault.lock();
    const pending = a.vault.unlockWithPasskey();
    a.vault.lock();
    await expect(pending).rejects.toMatchObject({ code: 'locked' });
    expect(a.vault.status.state).toBe('locked');
    expect(a.vault.holdsKeyMaterial()).toBe(false);
    await a.vault.unlockWithPasskey();
    expect(a.vault.status.state).toBe('unlocked');
  });

  test('forgetDevice() during a pending recovery restore leaves nothing behind', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    const { recoveryCode } = await a.vault.create({ setupCode: SETUP });
    const b = await makeDevice(server, null);
    const pending = b.vault.unlockWithRecoveryCode(recoveryCode);
    await b.vault.forgetDevice();
    await expect(pending).rejects.toMatchObject({ code: 'locked' });
    expect(b.vault.status.state).toBe('empty');
    expect(await b.db.get('vault', RECORD_KEY)).toBeUndefined();
  });
});

describe('old-epoch blobs and writes after a rotation', () => {
  test('a blob sealed with an old key and planted after the device learned of a newer epoch is refused and counted', async () => {
    const { server, a, oldCode } = await twoDevices();
    await a.vault.sync(); // A knows epoch 2 from its own rotation
    const vaultId = (server.claimed as { vaultId: string }).vaultId;
    const dk1 = (await keysFromOldCode(server, oldCode)).get(1) as CryptoKey;
    const forged = { ...(BOOK[9] as Entry), note: 'forged with the old key' } as Entry;
    const [sealed] = await sealEntries(dk1, vaultId, 1, [forged]);
    const later = String(a.scheduler.now() + 20 * 60_000).padStart(13, '0');
    server.blobs.set(`e/${later}-0000000000000000`, (sealed as NonNullable<typeof sealed>).blob);
    expect((await a.vault.sync()).ok).toBe(true);
    expect(a.vault.status.sync.staleEpoch).toBe(1);
    expect((await a.vault.store.list()).some((e) => e.id === forged.id && e.note === 'forged with the old key')).toBe(false);
  });

  test('old-epoch blobs uploaded before the rotation still arrive on a device that learns of it later', async () => {
    const server = new FakeServer(SETUP);
    const phone = new FakeAuthenticator('phone');
    const a = await makeDevice(server, phone);
    await a.vault.create({ setupCode: SETUP });
    const d = await makeDevice(server, phone);
    await d.vault.unlockWithPasskey();
    await a.vault.store.append(BOOK.slice(0, 2)); // epoch 1, D hasn't pulled them
    await a.vault.sync();
    await a.vault.rotateRecoveryCode();
    await a.vault.store.append(BOOK.slice(2, 3)); // epoch 2
    await a.vault.sync();
    expect((await d.vault.sync()).ok).toBe(true); // learns epoch 2, then pulls both epochs
    expect(d.vault.status.sync).toMatchObject({ staleEpoch: 0, rejected: 0 });
    expect(await d.vault.store.list()).toEqual(BOOK.slice(0, 3));
  });

  test('a device unlocked with the old code cannot write once it knows the code was replaced', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    const { recoveryCode } = await a.vault.create({ setupCode: SETUP });
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    await a.vault.rotateRecoveryCode();
    await b.vault.sync(); // learns epoch 2 (signed out: its old-code session is dead)
    await expect(b.vault.store.append(BOOK.slice(0, 1))).rejects.toMatchObject({ code: 'recovery-code-changed' });
    expect(await b.db.keys('outbox')).toEqual([]);
  });

  test('a passkey device behind a rotation fetches the newer key before sealing, or asks to sign in', async () => {
    const { server, phone, a } = await twoDevices();
    const c = await makeDevice(server, phone);
    await c.vault.unlockWithPasskey();
    c.client.expireSession();
    await a.vault.rotateRecoveryCode(); // epoch 3
    expect(await c.vault.sync()).toMatchObject({ ok: false, reason: 'signed-out' }); // C now knows epoch 3, no key
    await expect(c.vault.store.append(BOOK.slice(4, 5))).rejects.toMatchObject({ code: 'needs-session' });
    expect(await c.db.keys('outbox')).toEqual([]);
    await c.vault.connect();
    await c.vault.store.append(BOOK.slice(4, 5));
    const [sealed] = (await c.db.entries('outbox')).map(([, v]) => v as Uint8Array);
    expect(sealed === undefined ? 3 : blobEpoch(sealed)).toBe(3);
    await c.vault.sync();
    expect(blobEpoch(server.blobs.get(server.keys().at(-1) as string) as Uint8Array)).toBe(3);
  });
});

describe('logout is queued on any failure', () => {
  test('a 5xx or 429 on logout keeps it queued until it goes through', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    await a.vault.create({ setupCode: SETUP });
    for (const status of [503, 429]) {
      const cookie = a.client.cookie as string;
      server.failing.set('/api/logout', status);
      a.vault.lock();
      await settle();
      expect(server.revoked.has(cookie)).toBe(false);
      expect(parseRecord(await a.db.get('vault', RECORD_KEY))?.logoutPending).toBe(true);
      server.failing.delete('/api/logout');
      await a.vault.unlockWithPasskey(); // sends the queued logout first
      expect(server.revoked.has(cookie)).toBe(true);
      expect(parseRecord(await a.db.get('vault', RECORD_KEY))?.logoutPending).toBe(false);
    }
  });

  test('a logout that still fails is dropped once a new sign-in replaces the cookie (it must not end the new session)', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('phone'));
    await a.vault.create({ setupCode: SETUP });
    server.failing.set('/api/logout', 503);
    a.vault.lock();
    await settle();
    await a.vault.unlockWithPasskey();
    server.failing.delete('/api/logout');
    const fresh = a.client.cookie as string;
    expect(parseRecord(await a.db.get('vault', RECORD_KEY))?.logoutPending).toBe(false);
    expect((await a.vault.sync()).ok).toBe(true);
    expect(server.revoked.has(fresh)).toBe(false);
  });
});
