import type { R2Bucket } from '@cloudflare/workers-types';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { b64u, FLAGS, SoftAuthenticator } from './authenticator.ts';
import {
  claimVault, Client, fakeBlob, fakeCredentialKeys, fakeVault, forgeToken, ORIGIN, RP_ID, SETUP_CODE, startServer,
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

describe('register → login → upload → list', () => {
  it('runs the whole flow with a software passkey', async () => {
    const fresh = new Client(server);
    expect((await fresh.get('/api/status')).data).toEqual({ claimed: false });

    const { client, auth, vault } = await claimVault(server);
    expect(client.cookie).toMatch(/^bb_session=/);
    expect((await fresh.get('/api/status')).data).toEqual({ claimed: true });

    // A new device logs in with the passkey.
    const device = new Client(server);
    const opts = await device.post('/api/login/options');
    expect(opts.status).toBe(200);
    expect(opts.data.options).toMatchObject({ rpId: RP_ID, userVerification: 'required' });
    const login = await device.login(auth);
    expect(login.status).toBe(200);
    expect(login.setCookie).toMatch(/^bb_session=[^;]+; HttpOnly; Secure; SameSite=Strict; Path=\/api; Max-Age=43200$/);
    expect(login.data.vaultId).toBe(vault.vaultId);
    expect(login.data.prfSalt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.data.wrappedDk).toMatch(/^[A-Za-z0-9_-]{80}$/);

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
    expect((await c.get('/api/status')).data).toEqual({ claimed: false });
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

  it('rejects registration without a session after the claim, and allows it with one', async () => {
    const { client } = await claimVault(server);
    const stranger = new Client(server);
    expect((await stranger.registerOptions()).status).toBe(401);

    const second = new SoftAuthenticator();
    const added = await client.register(second);
    expect(added.status).toBe(201);
    expect(added.data.credentialId).toBe(second.id);
    expect((await new Client(server).login(second)).status).toBe(200);

    const withClaim = await client.register(new SoftAuthenticator(), { claim: fakeVault() });
    expect(withClaim.status).toBe(409);
  });

  it('excludes existing credentials from new registrations', async () => {
    const { client, auth } = await claimVault(server);
    const opts = await client.registerOptions();
    expect(opts.data.options.excludeCredentials).toEqual([expect.objectContaining({ id: auth.id })]);
  });

  it('rejects attestations for the wrong origin, RP or without user verification', async () => {
    const { client } = await claimVault(server);
    for (const tweak of [{ origin: 'https://evil.example' }, { rpId: 'evil.example' }, { flags: FLAGS.UP | FLAGS.AT }, { type: 'webauthn.get' }]) {
      const opts = await client.registerOptions();
      const response = new SoftAuthenticator().register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge, ...tweak });
      const res = await client.post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys() });
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
    // Register the same credential again: the Worker tries to write the same key.
    const res = await client.register(auth, { prfSalt: b64u(randomBytes(32)), wrappedDk: b64u(randomBytes(60)) });
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
    const routes = ['/api/register/options', '/api/register/verify', '/api/login/options', '/api/login/verify', '/api/recovery/login', '/api/recovery/rotate', '/api/logout'];
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
  it('accepts exactly the padded bucket sizes with version byte 1', async () => {
    const { client } = await claimVault(server);
    for (const kib of [1, 4, 16, 64]) expect((await client.post('/api/blobs', fakeBlob(kib))).status).toBe(201);
    for (const size of [0, 1, 1052, 1054, 2048 + 29, 4096]) {
      const b = randomBytes(size);
      if (size) b[0] = 1;
      expect((await client.post('/api/blobs', b)).status, String(size)).toBe(400);
    }
    const wrongVersion = fakeBlob();
    wrongVersion[0] = 2;
    expect((await client.post('/api/blobs', wrongVersion)).status).toBe(400);
    expect((await client.post('/api/blobs', randomBytes(64 * 1024 + 30))).status).toBe(413);
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

  it('accepts a valid signed session and rejects tampered, foreign and expired ones', async () => {
    await claimVault(server);
    const exp = Date.now() + 60_000;
    expect((await blobsWith(`bb_session=${forgeToken({ typ: 'session', kind: 'passkey', exp })}`)).status).toBe(200);

    const good = forgeToken({ typ: 'session', kind: 'passkey', exp });
    const [body, sig] = good.split('.') as [string, string];
    const flipped = sig.slice(0, -2) + (sig.at(-2) === 'A' ? 'B' : 'A') + sig.at(-1);
    const otherBody = b64u(Buffer.from(JSON.stringify({ typ: 'session', kind: 'passkey', exp: exp + 1e9 })));
    for (const cookie of [
      `bb_session=${body}.${flipped}`,
      `bb_session=${otherBody}.${sig}`,
      `bb_session=${forgeToken({ typ: 'session', kind: 'passkey', exp }, 'some-other-secret-0123456789-abcdef')}`,
      `bb_session=${forgeToken({ typ: 'session', kind: 'passkey', exp: Date.now() - 1 })}`,
      `bb_session=${forgeToken({ typ: 'login', ch: 'x', exp })}`,
      `bb_session=${body}`,
      'bb_session=',
      'other=1',
    ]) {
      expect((await blobsWith(cookie)).status, cookie).toBe(401);
    }
  });

  it('logout clears the cookie', async () => {
    const { client } = await claimVault(server);
    const res = await client.post('/api/logout');
    expect(res.status).toBe(200);
    expect(res.setCookie).toBe('bb_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0');
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
    expect((await client.post('/api/register/verify', { response: reg, challengeToken: expired, ...fakeCredentialKeys() })).status).toBe(401);
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
});

describe('recovery', () => {
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
    expect(ok.data).toEqual({ wrappedDk: vault.recovery.wrappedDk, version: 1 });
    expect((await c.get('/api/blobs')).status).toBe(200);
  });

  it('has no params before the claim', async () => {
    expect((await new Client(server).get('/api/recovery/params')).status).toBe(404);
    expect((await new Client(server).post('/api/recovery/login', { authToken: b64u(randomBytes(32)) })).status).toBe(401);
  });

  it('rotates to a new version; the old kit stops working', async () => {
    const { client, vault } = await claimVault(server);
    const next = fakeVault();
    expect((await new Client(server).post('/api/recovery/rotate', { version: 2, ...next.recovery })).status).toBe(401);
    expect((await client.post('/api/recovery/rotate', { version: 3, ...next.recovery })).status).toBe(409);
    expect((await client.post('/api/recovery/rotate', { version: 1, ...next.recovery })).status).toBe(409);
    expect((await client.post('/api/recovery/rotate', { version: 2, ...next.recovery, wrappedDk: 'x' })).status).toBe(400);
    expect(await client.post('/api/recovery/rotate', { version: 2, ...next.recovery })).toMatchObject({ status: 201, data: { version: 2 } });

    const c = new Client(server);
    expect((await c.get('/api/recovery/params')).data).toEqual({ vaultId: vault.vaultId, version: 2, salt: next.recovery.salt });
    expect((await c.post('/api/recovery/login', { authToken: vault.authToken })).status).toBe(401);
    expect((await c.post('/api/recovery/login', { authToken: next.authToken })).data).toEqual({ wrappedDk: next.recovery.wrappedDk, version: 2 });
  });
});
