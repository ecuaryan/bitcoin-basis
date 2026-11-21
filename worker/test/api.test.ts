import type { R2Bucket } from '@cloudflare/workers-types';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { b64u, FLAGS, SoftAuthenticator } from './authenticator.ts';
import {
  claimVault, Client, COOKIE, fakeBlob, fakeCredentialKeys, fakeRotation, fakeVault, forgeToken, ORIGIN, RP_ID, SETUP_CODE, startServer,
} from './harness.ts';

const server = startServer();
beforeAll(() => server.listen(), 60_000);
beforeEach(() => server.reset(), 60_000);
afterAll(() => server.close());

const env = () => server.getWorker<{ DATA: R2Bucket; BACKUP: R2Bucket }>().getEnv();
const bytesOf = async (key: string) => {
  const o = await (await env()).DATA.get(key);
  return o ? new Uint8Array(await o.arrayBuffer()) : null;
};
const keysUnder = async (prefix: string) => (await (await env()).DATA.list({ prefix })).objects.map((o) => o.key);
const sid = () => b64u(randomBytes(16));

describe('register → login → upload → list', () => {
  it('runs the whole flow with a software passkey', async () => {
    const fresh = new Client(server);
    expect((await fresh.get('/api/status')).data).toEqual({ claimed: false });

    const { client, auth, vault } = await claimVault(server);
    expect(client.cookie).toMatch(/^__Secure-bb_session=/);
    expect((await fresh.get('/api/status')).data).toEqual({ claimed: true });
    expect((await keysUnder('')).filter((k) => !k.startsWith('used/')).sort()).toEqual(
      [`cred/${auth.id}`, `epoch/000001/cred/${auth.id}`, 'meta/claimed', 'recovery/000001'].sort(),
    );

    // A new device logs in with the passkey and gets its credential key and the current epoch's delivery.
    const device = new Client(server);
    const opts = await device.post('/api/login/options');
    expect(opts.status).toBe(200);
    expect(opts.data.options).toMatchObject({ rpId: RP_ID, userVerification: 'required' });
    const login = await device.login(auth);
    expect(login.status).toBe(200);
    expect(login.setCookie).toMatch(/^__Secure-bb_session=[^;]+; HttpOnly; Secure; SameSite=Strict; Path=\/api; Max-Age=7200$/);
    expect(login.data.vaultId).toBe(vault.vaultId);
    expect(login.data.credential).toMatchObject({ prfSalt: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), epoch: 1 });
    expect(login.data.credential.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(login.data.keys).toMatchObject({ epoch: 1, delivery: { epoch: 1, wrappedDk: expect.stringMatching(/^[A-Za-z0-9_-]{80}$/) }, history: null });

    // Upload three blobs from two devices, then list them in pages.
    const blobs = [fakeBlob(1), fakeBlob(4), fakeBlob(64)];
    const keysUp: string[] = [];
    for (const [i, blob] of blobs.entries()) {
      const up = await (i % 2 ? device : client).post('/api/blobs', blob);
      expect(up.status).toBe(201);
      expect(up.data.key).toMatch(/^e\/\d{13}-[0-9a-f]{16}$/);
      keysUp.push(up.data.key);
    }
    const all = await device.get('/api/blobs');
    expect(all.status).toBe(200);
    expect(all.data.more).toBe(false);
    expect(all.data.blobs.map((b: { key: string }) => b.key)).toEqual([...keysUp].sort());
    const sent = new Map(keysUp.map((k, i) => [k, blobs[i]]));
    for (const b of all.data.blobs) expect(new Uint8Array(Buffer.from(b.data, 'base64url'))).toEqual(sent.get(b.key));
    const first = await device.get('/api/blobs?limit=1');
    expect(first.data.blobs).toHaveLength(1);
    expect(first.data.more).toBe(true);
    const rest = await device.get(`/api/blobs?after=${first.data.blobs[0].key}&limit=200`);
    expect(rest.data.blobs).toHaveLength(2);
    expect(rest.data.more).toBe(false);
  });

  it('registration options ask for a resident key, user verification and PRF', async () => {
    const res = await new Client(server).registerOptions({ setupCode: SETUP_CODE });
    expect(res.status).toBe(200);
    expect(res.data.options).toMatchObject({
      rp: { id: RP_ID },
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} },
    });
    expect(typeof res.data.challengeToken).toBe('string');
  });
});

describe('claiming and adding passkeys', () => {
  it('rejects a wrong setup code while unclaimed', async () => {
    expect((await new Client(server).registerOptions({ setupCode: 'wrong-setup-code-000000' })).status).toBe(401);
    expect((await new Client(server).registerOptions({})).status).toBe(401);
  });

  it('requires the claim on the first registration, and validates it before writing anything', async () => {
    const c = new Client(server);
    const missing = await c.register(new SoftAuthenticator(), {}, { setupCode: SETUP_CODE });
    expect(missing.status).toBe(400);
    const vault = fakeVault();
    const bad = await c.register(new SoftAuthenticator(), { claim: { vaultId: vault.vaultId, recovery: { ...vault.recovery, salt: 'short' } } }, { setupCode: SETUP_CODE });
    expect(bad.status).toBe(400);
    const wrongEpoch = await c.register(new SoftAuthenticator(), { claim: { vaultId: vault.vaultId, recovery: vault.recovery } }, { setupCode: SETUP_CODE }, 2);
    expect(wrongEpoch.status).toBe(409);
    const badKey = await c.register(new SoftAuthenticator(), { claim: { vaultId: vault.vaultId, recovery: vault.recovery }, credentialKey: { ...fakeCredentialKeys().credentialKey, publicKey: b64u(Buffer.concat([Buffer.from([5]), randomBytes(64)])) } }, { setupCode: SETUP_CODE });
    expect(badKey.status).toBe(400);
    expect((await c.get('/api/status')).data).toEqual({ claimed: false });
    expect(await keysUnder('')).toEqual([]);
  });

  it('rejects the setup code after the vault is claimed', async () => {
    await claimVault(server);
    expect((await new Client(server).registerOptions({ setupCode: SETUP_CODE })).status).toBe(401);
  });

  it('rejects a setup-code challenge if someone else claimed the vault first', async () => {
    const late = new Client(server);
    const opts = await late.registerOptions({ setupCode: SETUP_CODE });
    await claimVault(server);
    const auth = new SoftAuthenticator();
    const vault = fakeVault();
    const response = auth.register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
    const res = await late.post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys() });
    expect(res.status).toBe(401);
    const again = await new Client(server).post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys(), claim: { vaultId: vault.vaultId, recovery: vault.recovery } });
    expect(again.status).toBe(409);
  });

  it('adding a passkey needs a session and a fresh step-up assertion', async () => {
    const { client, auth } = await claimVault(server);
    expect((await new Client(server).registerOptions()).status).toBe(401);

    const second = new SoftAuthenticator();
    expect((await client.register(second)).status).toBe(401); // session alone is not enough
    expect((await client.register(second, { stepUp: { response: auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: b64u(randomBytes(32)) }), challengeToken: 'x' } })).status).toBe(401);
    // A step-up token for another purpose, or issued to another session, does not count.
    expect((await client.register(second, { stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(401);
    const other = new Client(server);
    await other.login(auth);
    expect((await client.register(second, { stepUp: await other.stepUp(auth, 'register') })).status).toBe(401);
    // A step-up signed by a passkey that isn't registered does not count.
    expect((await client.register(second, { stepUp: await client.stepUp(new SoftAuthenticator(), 'register') })).status).toBe(401);
    expect(await keysUnder('cred/')).toEqual([`cred/${auth.id}`]);

    const added = await client.addPasskey(second, auth);
    expect(added.status).toBe(201);
    expect(added.data.credentialId).toBe(second.id);
    expect((await new Client(server).login(second)).status).toBe(200);

    const withClaim = await client.addPasskey(new SoftAuthenticator(), auth, { claim: fakeVault() });
    expect(withClaim.status).toBe(409);
  });

  it('a step-up assertion works once', async () => {
    const { client, auth } = await claimVault(server);
    const stepUp = await client.stepUp(auth, 'register');
    expect((await client.register(new SoftAuthenticator(), { stepUp })).status).toBe(201);
    expect((await client.register(new SoftAuthenticator(), { stepUp })).status).toBe(401);
  });

  it('excludes existing credentials from new registrations', async () => {
    const { client, auth } = await claimVault(server);
    const opts = await client.registerOptions();
    expect(opts.data.options.excludeCredentials).toEqual([expect.objectContaining({ id: auth.id })]);
  });

  it('rejects attestations for the wrong origin, RP or without user verification', async () => {
    const { client, auth } = await claimVault(server);
    for (const tweak of [{ origin: 'https://evil.example' }, { rpId: 'evil.example' }, { flags: FLAGS.UP | FLAGS.AT }, { type: 'webauthn.get' }]) {
      const stepUp = await client.stepUp(auth, 'register');
      const opts = await client.registerOptions();
      const response = new SoftAuthenticator().register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge, ...tweak });
      const res = await client.post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, stepUp, ...fakeCredentialKeys() });
      expect(res.status, JSON.stringify(tweak)).toBe(400);
    }
  });
});

describe('append-only storage', () => {
  it('a second put to an existing key returns 409 and the original bytes are unchanged', async () => {
    const { client, auth } = await claimVault(server);
    const key = `cred/${auth.id}`;
    const before = await bytesOf(key);
    expect(before).not.toBeNull();
    // Register the same credential again: the Worker refuses before writing anything.
    const res = await client.addPasskey(auth, auth);
    expect(res.status).toBe(409);
    expect(res.data).toEqual({ error: 'conflict' });
    expect(await bytesOf(key)).toEqual(before);
  });

  it('has no route that deletes or overwrites', async () => {
    const { client } = await claimVault(server);
    const up = await client.post('/api/blobs', fakeBlob());
    const before = await bytesOf(up.data.key);
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      for (const path of ['/api/blobs', `/api/${up.data.key}`, `/api/blobs/${up.data.key}`, `/api/blobs?key=${up.data.key}`]) {
        const res = await client.request(method, path, fakeBlob());
        expect([404, 405, 415], `${method} ${path}`).toContain(res.status);
      }
    }
    expect(await bytesOf(up.data.key)).toEqual(before);
    expect((await client.get('/api/blobs')).data.blobs).toHaveLength(1);
  });
});

describe('request guards', () => {
  it('rejects a wrong or missing Origin on every non-GET route', async () => {
    const { client } = await claimVault(server);
    const routes = ['/api/register/options', '/api/register/verify', '/api/login/options', '/api/login/verify', '/api/stepup/options', '/api/recovery/login', '/api/recovery/rotate', '/api/logout'];
    for (const path of routes) {
      for (const origin of ['https://evil.example', `${ORIGIN}.evil.example`, 'null', null]) {
        const res = await client.post(path, {}, { origin });
        expect(res.status, `${path} ${origin}`).toBe(403);
        expect(res.data).toEqual({ error: 'forbidden' });
      }
    }
    expect((await client.post('/api/blobs', fakeBlob(), { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('rejects the wrong content type', async () => {
    const { client } = await claimVault(server);
    expect((await client.post('/api/login/options', {}, { type: 'text/plain' })).status).toBe(415);
    expect((await client.post('/api/login/options', {}, { type: null })).status).toBe(415);
    expect((await client.post('/api/blobs', fakeBlob(), { type: 'application/json' })).status).toBe(415);
    expect((await client.post('/api/login/options', {}, { type: 'application/json; charset=utf-8' })).status).toBe(200);
  });

  it('rejects malformed and oversized JSON', async () => {
    const c = new Client(server);
    expect((await c.request('POST', '/api/recovery/login', new TextEncoder().encode('{nope'), { type: 'application/json' })).status).toBe(400);
    expect((await c.post('/api/recovery/login', [1, 2])).status).toBe(400);
    expect((await c.post('/api/login/options', { pad: 'x'.repeat(40_000) })).status).toBe(413);
  });

  it('answers unknown routes and wrong methods with uniform JSON errors', async () => {
    const c = new Client(server);
    expect(await c.get('/api/nope')).toMatchObject({ status: 404, data: { error: 'not_found' } });
    expect(await c.get('/api/login/options')).toMatchObject({ status: 405, data: { error: 'method_not_allowed' } });
  });
});

describe('blobs', () => {
  it('accepts exactly the padded bucket sizes with version byte 2 and the current epoch', async () => {
    const { client } = await claimVault(server);
    for (const kib of [1, 4, 16, 64]) expect((await client.post('/api/blobs', fakeBlob(kib))).status).toBe(201);
    for (const size of [0, 1, 1053, 1056, 2048 + 33, 4096]) {
      const b = randomBytes(size);
      if (size) b[0] = 2;
      expect((await client.post('/api/blobs', b)).status, String(size)).toBe(400);
    }
    const wrongVersion = fakeBlob();
    wrongVersion[0] = 1;
    expect((await client.post('/api/blobs', wrongVersion)).status).toBe(400);
    expect((await client.post('/api/blobs', fakeBlob(1, 2))).status).toBe(409);
    expect((await client.post('/api/blobs', fakeBlob(1, 0))).status).toBe(409);
    expect((await client.post('/api/blobs', randomBytes(64 * 1024 + 34))).status).toBe(413);
    expect((await client.post('/api/blobs', randomBytes(1024 * 1024))).status).toBe(413);
  });

  it('requires a session to read or write', async () => {
    await claimVault(server);
    const c = new Client(server);
    expect((await c.post('/api/blobs', fakeBlob())).status).toBe(401);
    expect((await c.get('/api/blobs')).status).toBe(401);
  });

  it('validates list parameters', async () => {
    const { client } = await claimVault(server);
    for (const q of ['limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'limit=1.5', 'after=cred/x', 'after=e/123', 'after=e/0000000000000-XYZ']) {
      expect((await client.get(`/api/blobs?${q}`)).status, q).toBe(400);
    }
    expect((await client.get('/api/blobs?after=e/0000000000000')).status).toBe(200);
  });
});

describe('sessions', () => {
  const blobsWith = (cookie: string) => new Client(server).get('/api/blobs', { cookie });

  it('accepts a valid signed session and rejects tampered, foreign, expired and old-format ones', async () => {
    await claimVault(server);
    const exp = Date.now() + 60_000;
    const s = sid();
    expect((await blobsWith(`${COOKIE}=${forgeToken({ typ: 'session', sid: s, kind: 'passkey', exp })}`)).status).toBe(200);

    const good = forgeToken({ typ: 'session', sid: s, kind: 'passkey', exp });
    const [body, sig] = good.split('.') as [string, string];
    const flipped = sig.slice(0, -2) + (sig.at(-2) === 'A' ? 'B' : 'A') + sig.at(-1);
    const otherBody = b64u(Buffer.from(JSON.stringify({ typ: 'session', sid: s, kind: 'passkey', exp: exp + 1e9 })));
    for (const cookie of [
      `${COOKIE}=${body}.${flipped}`,
      `${COOKIE}=${otherBody}.${sig}`,
      `${COOKIE}=${forgeToken({ typ: 'session', sid: s, kind: 'passkey', exp }, 'some-other-secret-0123456789-abcdef')}`,
      `${COOKIE}=${forgeToken({ typ: 'session', sid: s, kind: 'passkey', exp: Date.now() - 1 })}`,
      `${COOKIE}=${forgeToken({ typ: 'session', kind: 'passkey', exp })}`, // no session id
      `${COOKIE}=${forgeToken({ typ: 'session', sid: s, kind: 'admin', exp })}`,
      `${COOKIE}=${forgeToken({ typ: 'login', ch: 'x', exp })}`,
      `bb_session=${good}`, // the old, unprefixed name
      `${COOKIE}=${body}`,
      `${COOKIE}=`,
      'other=1',
    ]) {
      expect((await blobsWith(cookie)).status, cookie).toBe(401);
    }
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const { client } = await claimVault(server);
    const stolen = client.cookie as string;
    const res = await client.post('/api/logout');
    expect(res.status).toBe(200);
    expect(res.setCookie).toBe(`${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`);
    expect(await keysUnder('revoked/')).toHaveLength(1);
    expect((await blobsWith(stolen)).status).toBe(401);
    // A second logout with the same cookie is harmless; one without a session writes nothing.
    expect((await new Client(server).post('/api/logout', {}, { cookie: stolen })).status).toBe(200);
    expect((await new Client(server).post('/api/logout')).status).toBe(200);
    expect(await keysUnder('revoked/')).toHaveLength(1);
  });

  it('recovery sessions can read, upload and register (with the recovery proof), but not rotate or step up', async () => {
    const { vault } = await claimVault(server);
    const r = new Client(server);
    expect((await r.post('/api/recovery/login', { authToken: vault.authToken })).status).toBe(200);
    expect((await r.post('/api/blobs', fakeBlob())).status).toBe(201);
    expect((await r.get('/api/blobs')).status).toBe(200);
    expect((await r.post('/api/stepup/options', { purpose: 'rotate' })).status).toBe(401);
    expect((await r.get('/api/credentials')).status).toBe(401);
    expect((await r.post('/api/recovery/rotate', { ...fakeRotation(2, []).body, stepUp: { authToken: vault.authToken } })).status).toBe(401);
    expect((await r.register(new SoftAuthenticator(), { stepUp: { authToken: b64u(randomBytes(32)) } })).status).toBe(401);
    const phone = new SoftAuthenticator();
    expect((await r.register(phone, { stepUp: { authToken: vault.authToken } })).status).toBe(201);
    expect((await new Client(server).login(phone)).status).toBe(200);
  });
});

describe('challenges', () => {
  it('a login challenge token works once', async () => {
    const { auth } = await claimVault(server);
    const c = new Client(server);
    const opts = await c.post('/api/login/options');
    const assertion = () => auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
    expect((await c.post('/api/login/verify', { response: assertion(), challengeToken: opts.data.challengeToken })).status).toBe(200);
    expect((await c.post('/api/login/verify', { response: assertion(), challengeToken: opts.data.challengeToken })).status).toBe(401);
  });

  it('rejects expired, tampered and wrong-purpose challenge tokens', async () => {
    const { client, auth } = await claimVault(server);
    const ch = b64u(randomBytes(32));
    const response = auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: ch });
    for (const challengeToken of [
      forgeToken({ typ: 'login', ch, exp: Date.now() - 1 }),
      forgeToken({ typ: 'register', ch, exp: Date.now() + 60_000 }),
      forgeToken({ typ: 'stepup', purpose: 'rotate', ch, exp: Date.now() + 60_000 }),
      forgeToken({ typ: 'login', ch, exp: Date.now() + 60_000 }, 'some-other-secret-0123456789-abcdef'),
      'not-a-token',
    ]) {
      expect((await client.post('/api/login/verify', { response, challengeToken })).status).toBe(401);
    }
    // Sanity: the same assertion with a correctly signed, live token passes.
    expect((await client.post('/api/login/verify', { response, challengeToken: forgeToken({ typ: 'login', ch, exp: Date.now() + 60_000 }) })).status).toBe(200);

    // An expired registration challenge is refused too.
    const regCh = b64u(randomBytes(32));
    const reg = new SoftAuthenticator().register({ origin: ORIGIN, rpId: RP_ID, challenge: regCh });
    const expired = forgeToken({ typ: 'register', ch: regCh, via: 'session', exp: Date.now() - 1 });
    expect((await client.post('/api/register/verify', { response: reg, challengeToken: expired, stepUp: await client.stepUp(auth, 'register'), ...fakeCredentialKeys() })).status).toBe(401);
  });

  it('rejects an assertion signed for another challenge, origin or without user verification', async () => {
    const { auth } = await claimVault(server);
    const c = new Client(server);
    const cases = [
      () => auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: b64u(randomBytes(32)) }),
      (ch: string) => auth.assert({ origin: 'https://evil.example', rpId: RP_ID, challenge: ch }),
      (ch: string) => auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: ch, flags: FLAGS.UP }),
      (ch: string) => auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: ch }, { corruptSignature: true }),
      (ch: string) => new SoftAuthenticator().assert({ origin: ORIGIN, rpId: RP_ID, challenge: ch }),
    ];
    for (const [i, make] of cases.entries()) {
      const opts = await c.post('/api/login/options');
      const res = await c.post('/api/login/verify', { response: make(opts.data.options.challenge), challengeToken: opts.data.challengeToken });
      expect(res.status, `case ${i}`).toBe(401);
    }
  });

  it('a failed verification does not spend the challenge (no anonymous writes)', async () => {
    const { auth } = await claimVault(server);
    const c = new Client(server);
    const opts = await c.post('/api/login/options');
    const before = await keysUnder('used/');
    const bad = auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge }, { corruptSignature: true });
    expect((await c.post('/api/login/verify', { response: bad, challengeToken: opts.data.challengeToken })).status).toBe(401);
    expect(await keysUnder('used/')).toEqual(before);
    expect((await c.login(auth)).status).toBe(200);
  });
});

describe('recovery and epochs', () => {
  it('params, login with the right token, 401 with a wrong one', async () => {
    const { vault } = await claimVault(server);
    const c = new Client(server);
    const params = await c.get('/api/recovery/params');
    expect(params.data).toEqual({ vaultId: vault.vaultId, version: 1, salt: vault.recovery.salt });

    expect((await c.post('/api/recovery/login', { authToken: b64u(randomBytes(32)) })).status).toBe(401);
    expect((await c.post('/api/recovery/login', { authToken: 'short' })).status).toBe(400);
    expect(c.cookie).toBeUndefined();

    const ok = await c.post('/api/recovery/login', { authToken: vault.authToken });
    expect(ok.status).toBe(200);
    expect(ok.data).toEqual({ wrappedDk: vault.recovery.wrappedDk, version: 1, history: null });
    expect((await c.get('/api/blobs')).status).toBe(200);
  });

  it('has no params before the claim', async () => {
    expect((await new Client(server).get('/api/recovery/params')).status).toBe(404);
    expect((await new Client(server).post('/api/recovery/login', { authToken: b64u(randomBytes(32)) })).status).toBe(401);
  });

  it('rotation needs a passkey session, a rotate step-up and a delivery for every passkey; it starts a new epoch', async () => {
    const { client, auth, vault } = await claimVault(server);
    const second = new SoftAuthenticator();
    expect((await client.addPasskey(second, auth)).status).toBe(201);
    const ids = [auth.id, second.id];
    const oldRecovery = new Client(server);
    expect((await oldRecovery.post('/api/recovery/login', { authToken: vault.authToken })).status).toBe(200);

    const { next, body } = fakeRotation(2, ids);
    expect((await new Client(server).post('/api/recovery/rotate', body)).status).toBe(401);
    expect((await client.post('/api/recovery/rotate', body)).status).toBe(401); // no step-up
    expect((await client.post('/api/recovery/rotate', { ...body, stepUp: await client.stepUp(auth, 'register') })).status).toBe(401);
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(3, ids).body, stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(409);
    expect((await client.post('/api/recovery/rotate', { ...body, version: 1, stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(409);
    expect((await client.post('/api/recovery/rotate', { ...body, wrappedDk: 'x', stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(400);
    expect((await client.post('/api/recovery/rotate', { ...body, history: b64u(randomBytes(92)), stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(400);
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(409);
    const noBinding = fakeRotation(2, ids).body;
    delete (noBinding.deliveries[auth.id] as { binding?: string }).binding;
    expect((await client.post('/api/recovery/rotate', { ...noBinding, stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(400);
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(2, [...ids, b64u(randomBytes(32))]).body, stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(409);
    expect(await keysUnder('epoch/000002/')).toEqual([]);

    expect(await client.post('/api/recovery/rotate', { ...body, stepUp: await client.stepUp(auth, 'rotate') })).toMatchObject({ status: 201, data: { version: 2 } });
    expect((await keysUnder('epoch/000002/')).sort()).toEqual([`epoch/000002/cred/${auth.id}`, `epoch/000002/cred/${second.id}`, 'epoch/000002/history'].sort());

    const c = new Client(server);
    expect((await c.get('/api/recovery/params')).data).toEqual({ vaultId: vault.vaultId, version: 2, salt: next.recovery.salt });
    // The old code can't sign in any more, and its existing session is dead.
    expect((await c.post('/api/recovery/login', { authToken: vault.authToken })).status).toBe(401);
    expect((await oldRecovery.get('/api/blobs')).status).toBe(401);
    expect((await c.post('/api/recovery/login', { authToken: next.authToken })).data).toEqual({ wrappedDk: next.recovery.wrappedDk, version: 2, history: body.history });

    // Passkeys get the newest delivery and its history; blobs must now be sealed under epoch 2.
    const login = await new Client(server).login(second);
    const { ephemeralPublicKey, wrappedDk, binding } = body.deliveries[second.id] as { ephemeralPublicKey: string; wrappedDk: string; binding: string };
    expect(login.data.keys).toEqual({ epoch: 2, delivery: { epoch: 2, ephemeralPublicKey, wrappedDk }, history: body.history });
    // The credential list now carries each passkey's binding re-made under the epoch-2 key.
    expect((await client.get('/api/credentials')).data.credentials).toContainEqual({ id: second.id, publicKey: expect.any(String), epoch: 2, binding });
    expect((await client.post('/api/blobs', fakeBlob(1, 1))).status).toBe(409);
    expect((await client.post('/api/blobs', fakeBlob(1, 2))).status).toBe(201);
    // New passkeys must come with keys for the current epoch.
    expect((await client.addPasskey(new SoftAuthenticator(), auth)).status).toBe(409);
    expect((await client.addPasskey(new SoftAuthenticator(), auth, {}, 2)).status).toBe(201);
  });

  it('serves credentials and per-credential keys to passkey sessions', async () => {
    const { client, auth } = await claimVault(server);
    const creds = await client.get('/api/credentials');
    expect(creds.status).toBe(200);
    expect(creds.data.credentials).toEqual([{ id: auth.id, publicKey: expect.any(String), epoch: 1, binding: expect.any(String) }]);
    const keys = await client.get(`/api/keys?credential=${auth.id}`);
    expect(keys.data).toMatchObject({ epoch: 1, delivery: { epoch: 1 }, history: null });
    expect((await client.get(`/api/keys?credential=${b64u(randomBytes(32))}`)).data).toEqual({ epoch: 1, delivery: null, history: null });
    expect((await client.get('/api/keys?credential=x')).status).toBe(400);
  });
});

describe('configuration checks', () => {
  it('rate-limits sign-in attempts per client IP', async () => {
    await claimVault(server);
    const c = new Client(server);
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await c.post('/api/recovery/login', { authToken: b64u(randomBytes(32)) })).status);
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await new Client(server).post('/api/recovery/login', { authToken: b64u(randomBytes(32)) })).status).toBe(401);
  });
});
