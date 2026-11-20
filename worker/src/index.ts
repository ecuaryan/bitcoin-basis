// Bitcoin Basis sync Worker: an append-only, encrypted mailbox in front of private R2.
// The contract is docs/sync-protocol.md. Static assets are served by Workers static
// assets before this code runs; only /api/* reaches it.
import { fromB64u, randomBytes, sameSecret, sha256, toB64u } from './crypto.ts';
import { errorResponse, fail, finish, guard, HttpError, json, readBytes, readJson } from './http.ts';
import {
  backup, currentRecovery, getJson, listAll, putNew, recoveryKey,
  type Claimed, type Credential, type Env,
} from './store.ts';
import { clearedCookie, hasSession, newChallenge, sessionCookie, useChallenge } from './session.ts';
import { b64u, credentialResponse, obj, recoveryInput, vaultId, wrappedDk } from './validate.ts';
import { loginOptions, registrationOptions, verifyLogin, verifyRegistration } from './webauthn.ts';

const MAX_JSON = 32 * 1024;
const BLOB_SIZES = new Set([1, 4, 16, 64].map((kib) => kib * 1024 + 12 + 16 + 1));
const MAX_BLOB = 64 * 1024 + 29;
const PAGE_BYTES = 4 * 1024 * 1024;
const AFTER = /^e\/\d{13}(-[0-9a-f]{16})?$/;

type Ctx = { req: Request; env: Env; url: URL };

const isClaimed = async (env: Env) => (await env.DATA.head('meta/claimed')) !== null;
const credIds = async (env: Env) => (await listAll(env.DATA, 'cred/')).map((o) => o.key.slice('cred/'.length));

// ---- routes -----------------------------------------------------------------

const routes: Record<string, (c: Ctx) => Promise<Response>> = {
  'GET /api/status': async ({ env }) => json({ claimed: await isClaimed(env) }),

  'POST /api/register/options': async (c) => {
    const body = await readJson(c.req, MAX_JSON);
    let via: 'setup' | 'session' = 'session';
    if (!(await hasSession(c.req, c.env))) {
      const code = c.env.SETUP_CODE ?? '';
      const ok = typeof body.setupCode === 'string' && code.length >= 16 && (await sameSecret(body.setupCode, code));
      if (!ok || (await isClaimed(c.env))) fail(401);
      via = 'setup';
    }
    const { challenge, token } = await newChallenge(c.env, 'register', via);
    return json({ options: await registrationOptions(c.env, challenge, await credIds(c.env)), challengeToken: token });
  },

  'POST /api/register/verify': async (c) => {
    const { env } = c;
    const body = await readJson(c.req, MAX_JSON);
    const response = credentialResponse(body.response, ['clientDataJSON', 'attestationObject']);
    const prfSalt = b64u(body.prfSalt, 32);
    const wrapped = wrappedDk(body.wrappedDk);
    const claimed = await isClaimed(env);
    if (claimed && body.claim !== undefined) fail(409);
    // Validate everything before the first write, so a bad request can't leave a half-claimed vault.
    const claim = claimed ? undefined : { vaultId: vaultId(obj(body.claim).vaultId), recovery: recoveryInput(obj(body.claim).recovery) };
    const { ch, via } = await useChallenge(env, body.challengeToken, 'register');
    if (!(await hasSession(c.req, c.env)) && (via !== 'setup' || claimed)) fail(401);
    const cred = (await verifyRegistration(env, response, ch)) ?? fail(400);
    const now = new Date().toISOString();
    if (claim) {
      // meta/claimed is the lock: of two racing first registrations, only one gets past it.
      await putNew(env.DATA, 'meta/claimed', JSON.stringify({ vaultId: claim.vaultId, claimedAt: now }));
      await putNew(env.DATA, recoveryKey(1), JSON.stringify({ ...claim.recovery, createdAt: now }));
    }
    const record: Credential = { publicKey: cred.publicKey, transports: cred.transports, createdAt: now, prfSalt, wrappedDk: wrapped };
    await putNew(env.DATA, `cred/${cred.id}`, JSON.stringify(record));
    return json({ credentialId: cred.id }, 201, { 'Set-Cookie': await sessionCookie(env, 'passkey') });
  },

  'POST /api/login/options': async ({ req, env }) => {
    await readJson(req, MAX_JSON);
    const { challenge, token } = await newChallenge(env, 'login');
    return json({ options: await loginOptions(env, challenge), challengeToken: token });
  },

  'POST /api/login/verify': async ({ req, env }) => {
    const body = await readJson(req, MAX_JSON);
    const response = credentialResponse(body.response, ['clientDataJSON', 'authenticatorData', 'signature']);
    const id = response.id as string;
    const { ch } = await useChallenge(env, body.challengeToken, 'login');
    const cred = (await getJson<Credential>(env.DATA, `cred/${id}`)) ?? fail(401);
    const meta = (await getJson<Claimed>(env.DATA, 'meta/claimed')) ?? fail(401);
    if (!(await verifyLogin(env, response, ch, id, cred))) fail(401);
    const out = { vaultId: meta.vaultId, prfSalt: cred.prfSalt, wrappedDk: cred.wrappedDk };
    return json(out, 200, { 'Set-Cookie': await sessionCookie(env, 'passkey') });
  },

  'GET /api/recovery/params': async ({ env }) => {
    const meta = (await getJson<Claimed>(env.DATA, 'meta/claimed')) ?? fail(404);
    const current = (await currentRecovery(env.DATA)) ?? fail(404);
    return json({ vaultId: meta.vaultId, version: current.version, salt: current.record.salt });
  },

  'POST /api/recovery/login': async ({ req, env }) => {
    const token = fromB64u(b64u((await readJson(req, MAX_JSON)).authToken, 32)) ?? fail(400);
    const current = (await currentRecovery(env.DATA)) ?? fail(401);
    if (!(await sameSecret(toB64u(await sha256(token)), current.record.authVerifier))) fail(401);
    const out = { wrappedDk: current.record.wrappedDk, version: current.version };
    return json(out, 200, { 'Set-Cookie': await sessionCookie(env, 'recovery') });
  },

  'POST /api/recovery/rotate': async (c) => {
    if (!(await hasSession(c.req, c.env))) fail(401);
    const body = await readJson(c.req, MAX_JSON);
    const current = (await currentRecovery(c.env.DATA)) ?? fail(409);
    if (body.version !== current.version + 1) fail(409);
    const record = { ...recoveryInput(body), createdAt: new Date().toISOString() };
    await putNew(c.env.DATA, recoveryKey(current.version + 1), JSON.stringify(record));
    return json({ version: current.version + 1 }, 201);
  },

  'POST /api/blobs': async (c) => {
    if (!(await hasSession(c.req, c.env))) fail(401);
    const blob = await readBytes(c.req, MAX_BLOB);
    if (!BLOB_SIZES.has(blob.length) || blob[0] !== 1) fail(400);
    const key = `e/${String(Date.now()).padStart(13, '0')}-${[...randomBytes(8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    await putNew(c.env.DATA, key, blob);
    return json({ key }, 201);
  },

  'GET /api/blobs': async (c) => {
    if (!(await hasSession(c.req, c.env))) fail(401);
    const after = c.url.searchParams.get('after');
    const limitText = c.url.searchParams.get('limit') ?? '100';
    const limit = Number(limitText);
    if ((after !== null && !AFTER.test(after)) || !/^\d{1,3}$/.test(limitText) || limit < 1 || limit > 200) fail(400);
    const page = await c.env.DATA.list({ prefix: 'e/', limit, ...(after ? { startAfter: after } : {}) });
    let budget = PAGE_BYTES;
    const objects = page.objects.filter((o, i) => (budget -= o.size) >= 0 || i === 0);
    const blobs = await Promise.all(objects.map(async ({ key }) => {
      const o = (await c.env.DATA.get(key)) ?? fail(500);
      return { key, data: toB64u(new Uint8Array(await o.arrayBuffer())) };
    }));
    return json({ blobs, more: page.truncated || objects.length < page.objects.length });
  },

  'POST /api/logout': async ({ req }) => {
    await readJson(req, MAX_JSON);
    return json({}, 200, { 'Set-Cookie': clearedCookie });
  },
};

// ---- entry points -----------------------------------------------------------

async function handle(req: Request, env: Env): Promise<Response> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || !env.ORIGIN || !env.RP_ID) fail(500);
  const url = new URL(req.url);
  if (req.method !== 'GET') guard(req, env.ORIGIN, url.pathname === '/api/blobs' ? 'application/octet-stream' : 'application/json');
  const route = routes[`${req.method} ${url.pathname}`];
  if (route) return route({ req, env, url });
  return fail(Object.keys(routes).some((r) => r.endsWith(` ${url.pathname}`)) ? 405 : 404);
}

export default {
  async fetch(req, env) {
    try {
      return finish(await handle(req, env));
    } catch (e) {
      if (e instanceof HttpError) return finish(errorResponse(e.status));
      console.error('unhandled error', e instanceof Error ? e.name : 'unknown');
      return finish(errorResponse(500));
    }
  },
  async scheduled(_controller, env) {
    console.log(`backup: copied ${await backup(env)} object(s)`);
  },
} satisfies ExportedHandler<Env>;
