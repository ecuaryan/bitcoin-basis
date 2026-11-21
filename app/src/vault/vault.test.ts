import { replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, test } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { fromBase64Url, randomBytes, toBase64Url, toHex } from './bytes.ts';
import { VaultError } from './errors.ts';
import { deliverDataKey, deriveRecoveryAuthToken } from './keys.ts';
import { RECORD_KEY, parseRecord } from './record.ts';
import { parseRecoveryCode, RecoveryCodeError } from './recovery-code.ts';
import { FakeAuthenticator } from './test/fake-authenticator.ts';
import { FakeServer } from './test/fake-server.ts';
import { makeDevice, settle, type Device } from './test/harness.ts';

const SETUP = 'setup-0123456789';
const MARK = 'PLAINTEXT-MARKER-7f3a';
const BOOK: readonly Entry[] = buildDemoBook().entries.map((e, i) => (i % 10 === 0 ? { ...e, note: `${MARK} #${i}` } : e));

async function setup() {
  const server = new FakeServer(SETUP);
  const auth = new FakeAuthenticator('phone');
  const a = await makeDevice(server, auth);
  const { recoveryCode } = await a.vault.create({ setupCode: SETUP });
  await a.vault.sync();
  return { server, auth, a, recoveryCode };
}

const list = (d: Device) => d.vault.store.list();
const record = async (d: Device) => parseRecord(await d.db.get('vault', RECORD_KEY));

describe('create', () => {
  test('claims the server, stores wrapped keys, returns a recovery code, starts unlocked', async () => {
    const { server, a, recoveryCode } = await setup();
    expect(recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);
    expect(server.claimed).not.toBeNull();
    expect(server.creds.size).toBe(1);
    expect(server.recovery.get(1)).toBeDefined();
    expect(a.vault.status).toMatchObject({ state: 'unlocked', unlockedWith: 'passkey', passkeyUnlock: true, vaultId: server.claimed?.vaultId });
    const r = await record(a);
    expect(r?.credentials).toHaveLength(1);
    expect(r?.recovery?.version).toBe(1);
    expect(fromBase64Url(r?.vaultId ?? '')).toHaveLength(16);
    expect(fromBase64Url(r?.recovery?.wrappedDk ?? '')).toHaveLength(60);
  });

  test('wrong setup code, already claimed, already on this device', async () => {
    const server = new FakeServer(SETUP);
    const a = await makeDevice(server, new FakeAuthenticator('x'));
    await expect(a.vault.create({ setupCode: 'nope' })).rejects.toMatchObject({ code: 'wrong-setup-code' });
    await a.vault.create({ setupCode: SETUP });
    await expect(a.vault.create({ setupCode: SETUP })).rejects.toMatchObject({ code: 'vault-exists' });
    const b = await makeDevice(server, new FakeAuthenticator('y'));
    await expect(b.vault.create({ setupCode: SETUP })).rejects.toMatchObject({ code: 'already-claimed' });
  });

  test('a passkey without PRF cannot set up (and the server stays unclaimed)', async () => {
    const server = new FakeServer(SETUP);
    const auth = new FakeAuthenticator('old', { prfOnCreate: 'none' });
    const a = await makeDevice(server, auth);
    await expect(a.vault.create({ setupCode: SETUP })).rejects.toMatchObject({ code: 'prf-unavailable' });
    expect(server.claimed).toBeNull();
    expect(a.vault.status.state).toBe('empty');
    const b = await makeDevice(server, new FakeAuthenticator('z'), { prfSupport: 'unsupported' });
    const before = server.requests.length;
    await expect(b.vault.create({ setupCode: SETUP })).rejects.toMatchObject({ code: 'prf-unavailable' });
    expect(server.requests.length).toBe(before);
  });
});

describe('restore and sync', () => {
  test('a fresh device restores the full ledger from the recovery code alone', async () => {
    const { server, a, recoveryCode } = await setup();
    await a.vault.store.append(BOOK);
    expect((await a.vault.sync()).ok).toBe(true);
    expect(a.vault.status.sync.pending).toBe(0);
    server.maxPage = 1; // force paging

    // Device B: empty storage, no passkey, only the code (typed sloppily).
    const b = await makeDevice(server, null);
    const res = await b.vault.unlockWithRecoveryCode(`  ${recoveryCode.toLowerCase().replace(/-/g, ' ')} `);
    expect(res.via).toBe('recovery');
    expect(res.sync).toMatchObject({ ok: true });
    const listA = await list(a);
    const listB = await list(b);
    expect(listB).toHaveLength(BOOK.length);
    expect(listB).toEqual(listA);
    expect(JSON.stringify(replay(listB))).toBe(JSON.stringify(replay(listA)));
    expect((await b.db.keys('blobs')).sort()).toEqual(server.keys());
    expect((await record(b))?.cursor).toBe(server.keys().at(-1));
    expect(b.vault.status.passkeyUnlock).toBe(false);

    // Locked B unlocks again offline with the code (local recovery wrapping).
    b.vault.lock();
    b.client.offline = true;
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    expect(await list(b)).toEqual(listA);
  });

  test('typos are caught before any network call; a valid but wrong code is refused', async () => {
    const { server, recoveryCode } = await setup();
    const b = await makeDevice(server, null);
    const before = server.requests.length;
    const typo = (recoveryCode[0] === 'A' ? 'B' : 'A') + recoveryCode.slice(1);
    await expect(b.vault.unlockWithRecoveryCode(typo)).rejects.toBeInstanceOf(RecoveryCodeError);
    expect(server.requests.length).toBe(before);
    const other = '000G4-0R40M-30E20-9185G-R38E1-YZ4BJ'; // well-formed, not this vault's
    await expect(b.vault.unlockWithRecoveryCode(other)).rejects.toMatchObject({ code: 'wrong-recovery-code' });
    expect(b.vault.status.state).toBe('empty');
  });

  test('two devices append concurrently and converge', async () => {
    const { server, a, recoveryCode } = await setup();
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    const half = Math.floor(BOOK.length / 2);
    await Promise.all([a.vault.store.append(BOOK.slice(0, half)), b.vault.store.append(BOOK.slice(half))]);
    await Promise.all([a.vault.sync(), b.vault.sync()]);
    await a.vault.sync();
    await b.vault.sync();
    const listA = await list(a);
    expect(listA).toHaveLength(BOOK.length);
    expect(await list(b)).toEqual(listA);
    expect(new Set(listA.map((e) => e.id)).size).toBe(BOOK.length);
  });

  test('offline append is kept locally, then uploaded with backoff retries', async () => {
    const { server, a, recoveryCode } = await setup();
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    b.client.offline = true;
    await b.vault.store.append(BOOK.slice(0, 3));
    await settle();
    expect(await list(b)).toEqual(BOOK.slice(0, 3));
    expect(b.vault.status.sync).toMatchObject({ phase: 'offline', pending: 1 });
    expect(server.blobs.size).toBe(0);
    expect(b.scheduler.pending).toBeGreaterThan(0); // a retry is scheduled

    b.client.offline = false;
    await b.scheduler.advance(60_000);
    await b.vault.sync();
    expect(b.vault.status.sync).toMatchObject({ phase: 'idle', pending: 0 });
    expect(server.blobs.size).toBe(1);
    await a.vault.sync();
    expect(await list(a)).toEqual(BOOK.slice(0, 3));
  });

  test('a late upload behind the cursor is still found (ten-minute overlap)', async () => {
    const { server, a, recoveryCode } = await setup();
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    server.clock += 3_600_000;
    await a.vault.store.append(BOOK.slice(0, 2));
    await a.vault.sync();
    await b.vault.sync();
    expect(await list(b)).toHaveLength(2);
    // An upload stamped five minutes before B's last key lands after B listed.
    server.clock -= 300_000;
    await a.vault.store.append(BOOK.slice(2, 4));
    await a.vault.sync();
    const n = server.requests.length;
    await b.vault.sync();
    expect(await list(b)).toEqual(await list(a));
    expect(await list(b)).toHaveLength(4);
    expect(n).toBe(server.requests.length); // GETs aren't recorded: nothing was re-uploaded
  });

  test('retried uploads are deduped; same id with different content keeps the first and is counted', async () => {
    const { server, a, recoveryCode } = await setup();
    await a.vault.store.append(BOOK.slice(0, 2));
    await a.vault.sync();
    // The same sealed blob uploaded twice (response lost, retried).
    const [k] = server.keys();
    server.blobs.set(`e/${String(server.clock++).padStart(13, '0')}-ffffffffffffffff`, server.blobs.get(k as string) as Uint8Array<ArrayBuffer>);
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    expect(await list(b)).toEqual(BOOK.slice(0, 2));
    expect(b.vault.status.sync.conflicts).toBe(0);

    // B, offline, edits nothing but reuses an id A is about to use.
    b.client.offline = true;
    const original = BOOK[5] as Entry;
    await a.vault.store.append([original]);
    await a.vault.sync();
    await b.vault.store.append([{ ...original, note: 'different' } as Entry]);
    b.client.offline = false;
    await b.vault.sync();
    await a.vault.sync();
    expect(await list(a)).toEqual(await list(b));
    expect((await list(b)).find((e) => e.id === original.id)).toEqual(original);
    expect(b.vault.status.sync.conflicts).toBe(1);
  });

  test('a full compare notices blobs the server no longer lists; the device keeps its copy', async () => {
    const { server, a, recoveryCode } = await setup();
    await a.vault.store.append(BOOK.slice(0, 2));
    await a.vault.sync();
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    server.blobs.delete(server.keys()[0] as string);
    b.vault.lock();
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    await b.vault.sync();
    expect(b.vault.status.sync.missingOnServer).toBe(1);
    expect(await list(b)).toEqual(BOOK.slice(0, 2));
  });

  test('append validates entries and clear is refused (append-only)', async () => {
    const { a } = await setup();
    await expect(a.vault.store.append([{ id: 'x', kind: 'nope' } as unknown as Entry])).rejects.toThrow(TypeError);
    await expect(a.vault.store.clear()).rejects.toMatchObject({ code: 'append-only' });
    await a.vault.store.append([BOOK[0] as Entry, BOOK[0] as Entry]);
    await a.vault.store.append([BOOK[0] as Entry]);
    expect(await list(a)).toHaveLength(1);
  });
});

describe('passkeys', () => {
  test('online unlock: one prompt gives session and PRF', async () => {
    const { auth, a } = await setup();
    await a.vault.store.append(BOOK.slice(0, 5));
    await a.vault.sync();
    a.vault.lock();
    const gets = auth.calls.get;
    await a.vault.unlockWithPasskey();
    expect(auth.calls.get).toBe(gets + 1);
    expect(a.vault.status.state).toBe('unlocked');
    expect(await list(a)).toEqual(BOOK.slice(0, 5));
    expect((await a.vault.sync()).ok).toBe(true);
  });

  test('unlock shows the cached entries before any network listing answers', async () => {
    const { a } = await setup();
    await a.vault.store.append(BOOK.slice(0, 5));
    await a.vault.sync();
    a.vault.lock();
    expect(a.vault.store.isLoaded()).toBe(false);
    a.client.hangList = true;
    // The moment the vault says "unlocked", the local copy must already be in list().
    const atUnlocked: boolean[] = [];
    a.vault.subscribe((st) => {
      if (st.state === 'unlocked') atUnlocked.push(a.vault.store.isLoaded());
    });
    await a.vault.unlockWithPasskey();
    expect(atUnlocked.length).toBeGreaterThan(0);
    expect(atUnlocked.every(Boolean)).toBe(true);
    expect(a.vault.status.state).toBe('unlocked');
    expect(a.vault.store.isLoaded()).toBe(true);
    expect(await list(a)).toEqual(BOOK.slice(0, 5));
    expect(a.vault.status.sync.phase).toBe('syncing');
  });

  test.each([
    ['passkey, offline', 'offline', 'passkey'],
    ['passkey, hanging network', 'hang', 'passkey'],
    ['recovery code, offline', 'offline', 'code'],
    ['recovery code, hanging network', 'hang', 'code'],
  ] as const)('local entries are listed at unlock without the network (%s)', async (_n, net, how) => {
    const { a, recoveryCode } = await setup();
    await a.vault.store.append(BOOK.slice(0, 5));
    await a.vault.sync();
    a.vault.lock();
    if (net === 'offline') a.client.offline = true;
    else a.client.hangList = true;
    const atUnlocked: number[] = [];
    a.vault.subscribe((st) => {
      if (st.state === 'unlocked') atUnlocked.push(a.vault.store.isLoaded() ? 1 : 0);
    });
    if (how === 'passkey') await a.vault.unlockWithPasskey();
    else await a.vault.unlockWithRecoveryCode(recoveryCode);
    expect(atUnlocked.length).toBeGreaterThan(0);
    expect(atUnlocked.every((x) => x === 1)).toBe(true);
    expect(await list(a)).toEqual(BOOK.slice(0, 5));
  });

  test('offline unlock uses a local challenge; connect() later gets a session', async () => {
    const { auth, a } = await setup();
    await a.vault.store.append(BOOK.slice(0, 5));
    await a.vault.sync();
    a.vault.lock();
    a.client.offline = true;
    await a.vault.unlockWithPasskey();
    expect(await list(a)).toEqual(BOOK.slice(0, 5));
    a.client.offline = false;
    expect(await a.vault.sync()).toMatchObject({ ok: false, reason: 'signed-out' });
    expect(a.vault.status.sync.phase).toBe('signed-out');
    const gets = auth.calls.get;
    expect((await a.vault.connect()).ok).toBe(true);
    expect(auth.calls.get).toBe(gets + 1);
  });

  test('a fresh device with a synced passkey restores without the recovery code, in one prompt', async () => {
    const { server, auth, a } = await setup();
    await a.vault.store.append(BOOK.slice(0, 7));
    await a.vault.sync();
    const c = await makeDevice(server, auth);
    const gets = auth.calls.get;
    const res = await c.vault.unlockWithPasskey();
    expect(auth.calls.get).toBe(gets + 1); // one prompt: session and PRF together
    expect(res.sync).toMatchObject({ ok: true });
    expect(await list(c)).toEqual(await list(a));
    expect((await record(c))?.recovery).toBeNull();
    expect(c.vault.status.passkeyUnlock).toBe(true);
  });

  test('addPasskey wraps a new DK copy; the new passkey unlocks offline', async () => {
    const { server, auth, a } = await setup();
    await a.vault.store.append(BOOK.slice(0, 3));
    const { credentialId } = await a.vault.addPasskey();
    expect(server.creds.has(credentialId)).toBe(true);
    expect((await record(a))?.credentials).toHaveLength(2);
    a.vault.lock();
    a.client.offline = true;
    auth.creds.shift(); // only the new passkey is present now
    await a.vault.unlockWithPasskey();
    expect(await list(a)).toEqual(BOOK.slice(0, 3));
  });

  test('addPasskey without PRF registers nothing; a no-PRF device uses the recovery code', async () => {
    const { server, recoveryCode } = await setup();
    const b = await makeDevice(server, new FakeAuthenticator('old', { prfOnCreate: 'none' }));
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    await expect(b.vault.addPasskey()).rejects.toMatchObject({ code: 'prf-unavailable' });
    expect(server.creds.size).toBe(1);
    await expect(b.vault.unlockWithPasskey()).resolves.toMatchObject({ via: 'recovery' }); // already unlocked
    b.vault.lock();
    b.client.offline = true;
    await expect(b.vault.unlockWithPasskey()).rejects.toMatchObject({ code: 'no-passkey' });
  });

  test('a cancelled prompt leaves the vault locked', async () => {
    const { auth, a } = await setup();
    a.vault.lock();
    auth.cancelNext = true;
    await expect(a.vault.unlockWithPasskey()).rejects.toMatchObject({ code: 'cancelled' });
    expect(a.vault.status.state).toBe('locked');
  });
});

describe('adding a passkey when a synced one is already here', () => {
  /** Device A set up with a passkey that syncs (one authenticator shared by both devices); B restored with the code. */
  async function syncedSetup(bAuth?: FakeAuthenticator) {
    const server = new FakeServer(SETUP);
    const auth = new FakeAuthenticator('synced', { honorExclude: true });
    const a = await makeDevice(server, auth);
    const { recoveryCode, credentialId } = await a.vault.create({ setupCode: SETUP });
    await a.vault.store.append(BOOK.slice(0, 5));
    await a.vault.sync();
    const b = await makeDevice(server, bAuth ?? auth);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    return { server, auth, a, b, credentialId, recoveryCode };
  }
  const registrations = (server: FakeServer) => server.requests.filter((r) => r.path === '/api/register/verify').length;

  test('create refuses it (InvalidStateError), so the synced passkey is adopted: one sign-in prompt, nothing registered', async () => {
    const { server, auth, b, credentialId } = await syncedSetup();
    expect(b.vault.status.passkeyUnlock).toBe(false);
    const before = { creds: server.creds.size, registrations: registrations(server), create: auth.calls.create, get: auth.calls.get };
    const r = await b.vault.addPasskey();
    expect(r).toEqual({ credentialId, adopted: true });
    expect(auth.calls.create).toBe(before.create + 1);
    expect(auth.calls.get).toBe(before.get + 1); // the code was the step-up proof; one prompt to adopt
    expect(server.creds.size).toBe(before.creds); // never a duplicate
    expect(registrations(server)).toBe(before.registrations);
    expect(b.vault.status.passkeyUnlock).toBe(true);
    expect((await record(b))?.credentials.map((c) => c.id)).toEqual([credentialId]);
    // The server session is a passkey session now: rotation works here (one step-up prompt).
    const gets = auth.calls.get;
    await b.vault.rotateRecoveryCode();
    expect(auth.calls.get).toBe(gets + 1);
    expect(server.epoch()).toBe(2);
    // And the adopted passkey opens this device offline, with the newest key.
    b.vault.lock();
    b.client.offline = true;
    await b.vault.unlockWithPasskey();
    expect(await list(b)).toEqual(BOOK.slice(0, 5));
  });

  test('a synced passkey without PRF is not adopted, and nothing is registered', async () => {
    const noPrf = new FakeAuthenticator('synced', { honorExclude: true, prfOnGet: false });
    const { server, auth, b } = await syncedSetup(noPrf);
    noPrf.creds.push(...auth.creds); // the same passkey, synced to a provider that gives no PRF on this device
    const before = registrations(server);
    await expect(b.vault.addPasskey()).rejects.toMatchObject({ code: 'synced-passkey-no-prf' });
    expect(registrations(server)).toBe(before);
    expect(server.creds.size).toBe(1);
    expect(b.vault.status.passkeyUnlock).toBe(false);
    expect((await record(b))?.credentials).toEqual([]);
    expect(b.vault.status.state).toBe('unlocked');
  });

  test('adopted only when the key it opens is this vault\'s key', async () => {
    const { server, b, credentialId } = await syncedSetup();
    // A server that hands the passkey a different key than the one this device holds.
    const vaultId = (server.claimed as { vaultId: string }).vaultId;
    const pub = fromBase64Url((server.creds.get(credentialId) as { credentialKey: { publicKey: string } }).credentialKey.publicKey);
    const forged = await deliverDataKey(randomBytes(32), pub, vaultId, 1, credentialId);
    server.deliveries.set(`1/${credentialId}`, { ephemeralPublicKey: toBase64Url(forged.ephemeralPublicKey), wrappedDk: toBase64Url(forged.wrappedDk) });
    await expect(b.vault.addPasskey()).rejects.toMatchObject({ code: 'passkey-rejected' });
    expect(b.vault.status.passkeyUnlock).toBe(false);
  });

  test('a cancelled sign-in prompt leaves everything as it was', async () => {
    const { server, auth, b } = await syncedSetup();
    const create = auth.create.bind(auth);
    auth.create = async (o) => {
      const out = create(o);
      auth.cancelNext = true; // the create fails (already here), then the adopt prompt is dismissed
      return out;
    };
    await expect(b.vault.addPasskey()).rejects.toMatchObject({ code: 'cancelled' });
    expect(server.creds.size).toBe(1);
    expect(b.vault.status.passkeyUnlock).toBe(false);
  });
});

describe('recovery code rotation', () => {
  test('the new code restores a fresh device; the old one no longer does', async () => {
    const { server, a, recoveryCode } = await setup();
    await a.vault.store.append(BOOK.slice(0, 4));
    await a.vault.sync();
    const { recoveryCode: next } = await a.vault.rotateRecoveryCode();
    expect(next).not.toBe(recoveryCode);
    expect((await record(a))?.recovery?.version).toBe(2);
    const b = await makeDevice(server, null);
    await expect(b.vault.unlockWithRecoveryCode(recoveryCode)).rejects.toMatchObject({ code: 'wrong-recovery-code' });
    await b.vault.unlockWithRecoveryCode(next);
    expect(await list(b)).toEqual(BOOK.slice(0, 4));
    // A still unlocks offline with the new code.
    a.vault.lock();
    a.client.offline = true;
    await a.vault.unlockWithRecoveryCode(next);
    expect(a.vault.status.state).toBe('unlocked');
  });

  test('needs an unlocked vault', async () => {
    const { a } = await setup();
    a.vault.lock();
    await expect(a.vault.rotateRecoveryCode()).rejects.toBeInstanceOf(VaultError);
    await expect(a.vault.addPasskey()).rejects.toMatchObject({ code: 'locked' });
  });
});

describe('locking', () => {
  test('lock wipes plaintext and key references', async () => {
    const { a } = await setup();
    await a.vault.store.append(BOOK.slice(0, 10));
    let notified = 0;
    a.vault.store.subscribe(() => notified++);
    const states: string[] = [];
    a.vault.subscribe((s) => states.push(s.state));
    expect(a.vault.holdsKeyMaterial()).toBe(true);
    a.vault.lock();
    expect(await list(a)).toEqual([]);
    expect(a.vault.holdsKeyMaterial()).toBe(false);
    expect(a.vault.status).toMatchObject({ state: 'locked', unlockedWith: null, lockReason: 'user' });
    expect(a.vault.status.sync.phase).toBe('off');
    expect(notified).toBeGreaterThan(0);
    expect(states).toContain('locked');
    await expect(a.vault.store.append(BOOK.slice(10, 11))).rejects.toMatchObject({ code: 'locked' });
    expect(await a.vault.sync()).toMatchObject({ ok: false, reason: 'locked' });
  });

  test('idle auto-lock fires after the configured minutes without activity', async () => {
    const { a } = await setup();
    a.vault.setAutoLockMinutes(5);
    await a.scheduler.advance(4 * 60_000);
    expect(a.vault.status.state).toBe('unlocked');
    a.vault.touch();
    await a.scheduler.advance(4 * 60_000);
    expect(a.vault.status.state).toBe('unlocked');
    await a.scheduler.advance(61_000);
    expect(a.vault.status).toMatchObject({ state: 'locked', lockReason: 'idle' });
    expect(a.vault.holdsKeyMaterial()).toBe(false);
  });

  test('locks when the page was hidden longer than the delay; activity events count', async () => {
    const server = new FakeServer(SETUP);
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const a = await makeDevice(server, new FakeAuthenticator('p'), { environment: { document: doc as unknown as Document, window: null }, autoLockMinutes: 5 });
    await a.vault.create({ setupCode: SETUP });
    await a.scheduler.advance(4 * 60_000);
    doc.dispatchEvent(new Event('keydown'));
    await a.scheduler.advance(4 * 60_000);
    expect(a.vault.status.state).toBe('unlocked');
    // Hidden for two minutes: fine.
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    a.scheduler.skip(2 * 60_000);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(a.vault.status.state).toBe('unlocked');
    // Hidden (timers suspended) for six minutes: locks on return.
    doc.dispatchEvent(new Event('pointerdown'));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    a.scheduler.skip(6 * 60_000);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(a.vault.status).toMatchObject({ state: 'locked', lockReason: 'hidden' });
    a.vault.dispose();
  });

  test('coming back to the foreground pulls other devices\' changes right away', async () => {
    const server = new FakeServer(SETUP);
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const a = await makeDevice(server, new FakeAuthenticator('p'), { environment: { document: doc as unknown as Document, window: null }, autoLockMinutes: 5, pollIntervalMs: 0 });
    const { recoveryCode } = await a.vault.create({ setupCode: SETUP });
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    await b.vault.store.append(BOOK);
    await b.vault.sync();
    expect(await a.vault.store.list()).toHaveLength(0);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    a.scheduler.skip(60_000);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    // No poll (pollIntervalMs 0) and no explicit sync: only the foreground handler can fetch B's entries.
    await expect.poll(async () => (await a.vault.store.list()).length, { timeout: 2000 }).toBe(BOOK.length);
    a.vault.dispose();
    b.vault.dispose();
  });

  test('auto-lock 0 means never', async () => {
    const { a } = await setup();
    a.vault.setAutoLockMinutes(0);
    await a.scheduler.advance(24 * 60 * 60_000);
    expect(a.vault.status.state).toBe('unlocked');
  });
});

describe('no plaintext or secrets at rest or on the wire', () => {
  test('scan IndexedDB on both devices, server storage and every request body', async () => {
    const { server, auth, a, recoveryCode } = await setup();
    await a.vault.store.append(BOOK);
    await a.vault.sync();
    const b = await makeDevice(server, null);
    await b.vault.unlockWithRecoveryCode(recoveryCode);
    b.client.offline = true;
    await b.vault.store.append([{ ...(BOOK[1] as Entry), id: '017e1a04-5a80-7230-bb5c-0123456789ab', note: `${MARK} outbox` } as Entry]);
    await settle();
    expect(b.vault.status.sync.pending).toBe(1);

    const { secret } = await parseRecoveryCode(recoveryCode);
    const token = await deriveRecoveryAuthToken(secret, fromBase64Url(server.recovery.get(1)?.salt ?? ''));
    const latin1 = (u: Uint8Array) => Buffer.from(u).toString('latin1');
    const secrets = [secret, token, ...auth.prfOutputs];
    const needles = [MARK, ...BOOK.slice(0, 20).map((e) => e.id), 'wallet-coinbase', ...secrets.flatMap((s) => [toHex(s), latin1(s)])];
    const wireNeedles = [...needles, ...auth.prfOutputs.map(toBase64Url), toBase64Url(secret)];
    const text = (v: unknown): string => (v instanceof Uint8Array ? latin1(v) : JSON.stringify(v, (_k, x: unknown) => (x instanceof Uint8Array ? latin1(x) : x)));

    const stored = [...a.db.dump(), ...b.db.dump()].map((r) => text(r.value));
    expect(stored.length).toBeGreaterThan(3);
    const server_ = [...server.blobs.values(), ...server.creds.values(), ...server.recovery.values()].map(text);
    const wire = server.requests.map((r) => text(r.body));
    for (const n of needles) {
      for (const s of stored) expect(s.includes(n), `IndexedDB holds ${n.slice(0, 20)}`).toBe(false);
      for (const s of server_) expect(s.includes(n), `server holds ${n.slice(0, 20)}`).toBe(false);
    }
    for (const n of wireNeedles) for (const s of wire) expect(s.includes(n), `request carries ${n.slice(0, 20)}`).toBe(false);
  });
});
