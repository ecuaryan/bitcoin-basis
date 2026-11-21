// Regression tests for the Step 3 security review (2026-11-20). Each test states an attack and
// asserts the server now resists it.
import type { R2Bucket } from '@cloudflare/workers-types';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configOk } from '../src/config.ts';
import { SECURITY_HEADERS } from '../src/headers.ts';
import { b64u, SoftAuthenticator } from './authenticator.ts';
import { claimVault, Client, COOKIE, fakeBlob, fakeCredentialKeys, fakeRotation, fakeVault, ORIGIN, RP_ID, SETUP_CODE, startServer } from './harness.ts';

const server = startServer();
beforeAll(() => server.listen(), 60_000);
beforeEach(() => server.reset(), 60_000);
afterAll(() => server.close());

const env = () => server.getWorker<{ DATA: R2Bucket; BACKUP: R2Bucket }>().getEnv();
const keysUnder = async (prefix: string) => (await (await env()).DATA.list({ prefix })).objects.map((o) => o.key);

describe('single-use challenges and claim races', () => {
  it('a login challenge token raced by two concurrent verifies yields at most one session', async () => {
    const { auth } = await claimVault(server);
    const c = new Client(server);
    const opts = await c.post('/api/login/options');
    const response = auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
    const body = { response, challengeToken: opts.data.challengeToken };
    const results = await Promise.all(Array.from({ length: 8 }, () => new Client(server).post('/api/login/verify', body)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("two concurrent setup-code claims: exactly one wins and the stored vault is the winner's, whole", async () => {
    const mk = async () => {
      const c = new Client(server);
      const auth = new SoftAuthenticator();
      const vault = fakeVault();
      const opts = await c.registerOptions({ setupCode: SETUP_CODE });
      const response = auth.register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
      return { c, auth, vault, body: { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys(), claim: { vaultId: vault.vaultId, recovery: vault.recovery } } };
    };
    const [a, b] = await Promise.all([mk(), mk()]);
    const [ra, rb] = await Promise.all([a.c.post('/api/register/verify', a.body), b.c.post('/api/register/verify', b.body)]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const winner = ra.status === 201 ? a : b;
    const meta = await (await (await env()).DATA.get('meta/claimed'))?.json<{ vaultId: string }>();
    expect(meta?.vaultId).toBe(winner.vault.vaultId);
    expect(await keysUnder('cred/')).toEqual([`cred/${winner.auth.id}`]);
    expect(await keysUnder('epoch/')).toEqual([`epoch/000001/cred/${winner.auth.id}`]);
    expect(await keysUnder('recovery/')).toEqual(['recovery/000001']);
  });
});

describe('anonymous resource abuse', () => {
  it('a stranger cannot make the Worker write to R2 without a valid passkey assertion', async () => {
    await claimVault(server);
    const before = await keysUnder('');
    const stranger = new SoftAuthenticator(); // never registered
    for (let i = 0; i < 20; i++) {
      const c = new Client(server);
      const opts = await c.post('/api/login/options');
      const response = stranger.assert({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
      expect((await c.post('/api/login/verify', { response, challengeToken: opts.data.challengeToken })).status).toBe(401);
      expect((await c.post('/api/logout')).status).toBe(200);
    }
    expect(await keysUnder('')).toEqual(before);
  });
});

describe('what a session alone can do (stale cookie, lost unlocked device, XSS)', () => {
  it('a session token is dead after logout', async () => {
    const { client } = await claimVault(server);
    const stolen = client.cookie as string;
    await client.post('/api/logout');
    const thief = new Client(server);
    thief.cookie = stolen;
    expect((await thief.get('/api/blobs')).status).toBe(401);
    expect((await thief.post('/api/blobs', fakeBlob())).status).toBe(401);
  });

  it('a stale session cannot plant a permanent attacker passkey', async () => {
    const { client, auth } = await claimVault(server);
    const stolen = client.cookie as string;
    const stepUp = await client.stepUp(auth, 'register'); // even a step-up minted before logout
    await client.post('/api/logout');
    const thief = new Client(server);
    thief.cookie = stolen;
    const evil = new SoftAuthenticator();
    expect((await thief.register(evil, { stepUp })).status).toBe(401);
    expect((await new Client(server).login(evil)).status).toBe(401);
  });

  it('a live session without a fresh assertion cannot plant a passkey', async () => {
    const { client } = await claimVault(server);
    const evil = new SoftAuthenticator();
    expect((await client.register(evil)).status).toBe(401);
    expect((await client.register(evil, { stepUp: await client.stepUp(evil, 'register') })).status).toBe(401);
    expect(await keysUnder('cred/')).toHaveLength(1);
  });

  it("a session cannot silently invalidate the owner's recovery code", async () => {
    const { client, auth, vault } = await claimVault(server);
    const attacker = fakeRotation(2, [auth.id]);
    expect((await client.post('/api/recovery/rotate', attacker.body)).status).toBe(401);
    const recovery = new Client(server);
    await recovery.post('/api/recovery/login', { authToken: vault.authToken });
    expect((await recovery.post('/api/recovery/rotate', { ...attacker.body, stepUp: { authToken: vault.authToken } })).status).toBe(401);
    const owner = new Client(server);
    expect((await owner.post('/api/recovery/login', { authToken: vault.authToken })).status).toBe(200);
  });
});

describe('credential id handling', () => {
  it('a response.id that differs from the attested credential id is refused before any write', async () => {
    const auth = new SoftAuthenticator();
    Object.assign(auth, { credentialId: randomBytes(4) }); // authData id: 4 bytes; response.id stays 32 bytes
    const c = new Client(server);
    const opts = await c.registerOptions({ setupCode: SETUP_CODE });
    const response = { ...auth.register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge }), id: auth.id, rawId: auth.id };
    const v = fakeVault();
    const res = await c.post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys(), claim: { vaultId: v.vaultId, recovery: v.recovery } });
    expect(res.status).toBe(400);
    expect(await keysUnder('')).toEqual([]);
  });

  it('an over-long credential id leaves no claim behind', async () => {
    const auth = new SoftAuthenticator();
    Object.assign(auth, { credentialId: randomBytes(1000) });
    const c = new Client(server);
    const opts = await c.registerOptions({ setupCode: SETUP_CODE });
    const response = { ...auth.register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge }), id: auth.id, rawId: auth.id };
    const v = fakeVault();
    const res = await c.post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys(), claim: { vaultId: v.vaultId, recovery: v.recovery } });
    expect(res.status).toBe(400);
    expect(await keysUnder('')).toEqual([]);
    // Also when response.id itself is the long one.
    const long = b64u(randomBytes(1000));
    const res2 = await c.post('/api/register/verify', { response: { ...response, id: long, rawId: long }, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys(), claim: { vaultId: v.vaultId, recovery: v.recovery } });
    expect(res2.status).toBe(400);
    expect(await keysUnder('')).toEqual([]);
  });
});

describe('guards and headers on odd requests', () => {
  it('HEAD, OPTIONS, 413, 415, 429 and 403 all carry the security headers and no CORS', async () => {
    await claimVault(server);
    const big = new Uint8Array(40 * 1024).fill(0x20);
    const J = { 'Content-Type': 'application/json' };
    const reqs: [string, { method: string; headers: Record<string, string>; body?: string | Uint8Array }][] = [
      ['/api/status', { method: 'HEAD', headers: { Origin: ORIGIN, ...J } }],
      ['/api/blobs', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } }],
      ['/api/login/options', { method: 'POST', headers: { Origin: ORIGIN, ...J }, body: big }],
      ['/api/login/options', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: '{}' }],
      ['/api/login/options', { method: 'POST', headers: { Origin: 'null', ...J }, body: '{}' }],
      ['/api/login/options', { method: 'POST', headers: J, body: '{}' }],
      ['/api/login/options?_method=GET', { method: 'POST', headers: { Origin: 'https://evil.example', 'X-HTTP-Method-Override': 'GET', ...J }, body: '{}' }],
    ];
    for (let i = 0; i < 31; i++) reqs.push(['/api/recovery/login', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.9', ...J }, body: JSON.stringify({ authToken: b64u(randomBytes(32)) }) }]);
    for (const [path, init] of reqs) {
      const r = await server.fetch(`http://localhost${path}`, init);
      await r.arrayBuffer();
      const label = `${init.method} ${path} -> ${r.status}`;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers.get(k), `${label} ${k}`).toBe(v);
      expect(r.headers.get('Access-Control-Allow-Origin'), label).toBeNull();
      expect(r.status, label).toBeGreaterThanOrEqual(400);
    }
  });

  it('a lying Content-Length cannot smuggle an oversized blob', async () => {
    const { client } = await claimVault(server);
    const body = new Uint8Array(64 * 1024 + 33 + 1);
    body[0] = 2;
    const res = await server.fetch('http://localhost/api/blobs', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/octet-stream', Cookie: client.cookie as string },
      body,
    });
    expect([400, 413]).toContain(res.status);
  });

  it('the `after` cursor cannot escape the e/ prefix', async () => {
    const { client } = await claimVault(server);
    await client.post('/api/blobs', fakeBlob());
    for (const after of ['cred/', 'e/../cred', 'e/0000000000000-zzzzzzzzzzzzzzzz', 'd', '', 'e/0000000000000\u0000']) {
      const res = await client.get(`/api/blobs?after=${encodeURIComponent(after)}`);
      expect(res.status, after).toBe(400);
    }
  });

  it('challenge tokens cannot be used as sessions, nor sessions as challenges', async () => {
    const { client } = await claimVault(server);
    const opts = await new Client(server).post('/api/login/options');
    const asCookie = new Client(server);
    asCookie.cookie = `${COOKIE}=${opts.data.challengeToken}`;
    expect((await asCookie.get('/api/blobs')).status).toBe(401);
    const sessionToken = (client.cookie as string).slice(`${COOKIE}=`.length);
    const res = await new Client(server).post('/api/login/verify', { response: new SoftAuthenticator().assert({ origin: ORIGIN, rpId: RP_ID, challenge: b64u(randomBytes(32)) }), challengeToken: sessionToken });
    expect(res.status).toBe(401);
  });
});

describe('deployment configuration', () => {
  it('serves the API only on an https ORIGIN whose hostname is RP_ID (http only with the dev flag)', () => {
    const secret = 'x'.repeat(32);
    expect(configOk({ ORIGIN, RP_ID, SESSION_SECRET: secret })).toBe(true);
    expect(configOk({ ORIGIN: 'http://localhost:8787', RP_ID: 'localhost', SESSION_SECRET: secret })).toBe(false);
    expect(configOk({ ORIGIN: 'http://localhost:8787', RP_ID: 'localhost', SESSION_SECRET: secret, DEV_ALLOW_HTTP: '1' })).toBe(true);
    expect(configOk({ ORIGIN, RP_ID: 'example.test', SESSION_SECRET: secret })).toBe(false);
    expect(configOk({ ORIGIN: `${ORIGIN}/`, RP_ID, SESSION_SECRET: secret })).toBe(false);
    expect(configOk({ ORIGIN: `${ORIGIN}/app`, RP_ID, SESSION_SECRET: secret })).toBe(false);
    expect(configOk({ ORIGIN: 'not a url', RP_ID, SESSION_SECRET: secret })).toBe(false);
    expect(configOk({ ORIGIN, RP_ID, SESSION_SECRET: 'short' })).toBe(false);
    expect(configOk({ ORIGIN: 'ftp://basis.example.test', RP_ID, SESSION_SECRET: secret, DEV_ALLOW_HTTP: '1' })).toBe(false);
  });
});

describe('step-up binding', () => {
  it('a step-up is bound to its purpose, its session, and is single use', async () => {
    const { client, auth } = await claimVault(server);
    // purpose: a "register" step-up cannot rotate; a "rotate" step-up cannot register.
    const reg = await client.stepUp(auth, 'register');
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp: reg })).status).toBe(401);
    const rot = await client.stepUp(auth, 'rotate');
    expect((await client.register(new SoftAuthenticator(), { stepUp: rot })).status).toBe(401);
    // session: a step-up minted in session A is refused in session B (same passkey).
    const b = new Client(server);
    expect((await b.login(auth)).status).toBe(200);
    const fromA = await client.stepUp(auth, 'rotate');
    expect((await b.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp: fromA })).status).toBe(401);
    // single use: the same step-up cannot rotate twice (second attempt is 401, not a second epoch).
    const once = await client.stepUp(auth, 'rotate');
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp: once })).status).toBe(201);
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(3, [auth.id]).body, stepUp: once })).status).toBe(401);
  });
});

describe('revoked and outdated sessions die on every route', () => {
  it('a revoked passkey session is 401 everywhere', async () => {
    const { client, auth } = await claimVault(server);
    const stepUp = await client.stepUp(auth, 'register');
    const stolen = client.cookie as string;
    await client.post('/api/logout');
    const t = new Client(server);
    t.cookie = stolen;
    const res = [
      await t.post('/api/register/options'),
      await t.register(new SoftAuthenticator(), { stepUp }),
      await t.post('/api/stepup/options', { purpose: 'rotate' }),
      await t.get('/api/credentials'),
      await t.get(`/api/keys?credential=${auth.id}`),
      await t.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp }),
      await t.get('/api/blobs'),
      await t.post('/api/blobs', fakeBlob()),
    ];
    expect(res.map((r) => r.status)).toEqual(res.map(() => 401));
  });

  it('a recovery session cannot escalate, and is dead on every route once the code is rotated', async () => {
    const { client, auth, vault } = await claimVault(server);
    const rec = new Client(server);
    expect((await rec.post('/api/recovery/login', { authToken: vault.authToken })).status).toBe(200);
    for (const r of [
      await rec.post('/api/stepup/options', { purpose: 'register' }),
      await rec.get('/api/credentials'),
      await rec.get(`/api/keys?credential=${auth.id}`),
      await rec.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp: { authToken: vault.authToken } }),
    ]) expect(r.status).toBe(401);
    // Owner rotates.
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(201);
    for (const r of [
      await rec.get('/api/blobs'),
      await rec.post('/api/blobs', fakeBlob(1, 2)),
      await rec.post('/api/register/options'),
      await rec.register(new SoftAuthenticator(), { stepUp: { authToken: vault.authToken } }, {}, 2),
      await rec.post('/api/recovery/login', { authToken: vault.authToken }),
    ]) expect(r.status).toBe(401);
    // The old token is no step-up proof for a live passkey session either.
    expect((await client.register(new SoftAuthenticator(), { stepUp: { authToken: vault.authToken } }, {}, 2)).status).toBe(401);
  });
});

describe('credential bindings are served for the current epoch only', () => {
  it('a passkey record planted in storage after a rotation keeps its old binding (and the app refuses it)', async () => {
    const { client, auth } = await claimVault(server);
    expect((await client.post('/api/recovery/rotate', { ...fakeRotation(2, [auth.id]).body, stepUp: await client.stepUp(auth, 'rotate') })).status).toBe(201);
    const planted = b64u(randomBytes(32));
    const own = await (await (await env()).DATA.get(`cred/${auth.id}`))?.json<Record<string, unknown>>();
    await (await env()).DATA.put(`cred/${planted}`, JSON.stringify({ ...own, credentialKey: { ...(own?.credentialKey as object), epoch: 1 } }));
    const list = (await client.get('/api/credentials')).data.credentials as { id: string; epoch: number }[];
    expect(list.find((c) => c.id === auth.id)?.epoch).toBe(2);
    expect(list.find((c) => c.id === planted)?.epoch).toBe(1);
  });
});
