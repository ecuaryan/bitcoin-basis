// Bitcoin Basis sync Worker: an append-only, encrypted mailbox in front of private R2.
// The contract is docs/sync-protocol.md. Static assets are served by Workers static
// assets before this code runs; only /api/* reaches it.
import { configOk } from './config.ts';
import { fromB64u, randomBytes, sameSecret, sha256, toB64u } from './crypto.ts';
import { errorResponse, fail, finish, guard, HttpError, json, readBytes, readJson } from './http.ts';
import {
  backup, currentEpoch, currentRecovery, deliveryKey, getJson, history, historyKey, listAll, newestDelivery, putNew, recoveryKey,
  type Claimed, type Credential, type Delivery, type Env,
} from './store.ts';
import {
  burnChallenge, clearedCookie, newChallenge, readChallenge, requireSession, revoke, sessionCookie,
  type Session, type StepUpPurpose,
} from './session.ts';
import {
  b64u, credentialId, credentialKeyInput, credentialResponse, deliveryInput, historyCt, obj, posInt, recoveryInput, rotationDeliveryInput, stepUpInput, vaultId,
  type StepUpInput,
} from './validate.ts';
import { loginOptions, registrationOptions, verifyLogin, verifyRegistration } from './webauthn.ts';

const MAX_JSON = 32 * 1024;
/** Blob wire format v2: version (1) || epoch (4, big-endian) || iv (12) || ciphertext || tag (16). */
const BLOB_VERSION = 2;
const BLOB_OVERHEAD = 1 + 4 + 12 + 16;
const BLOB_SIZES = new Set([1, 4, 16, 64].map((kib) => kib * 1024 + BLOB_OVERHEAD));
const MAX_BLOB = 64 * 1024 + BLOB_OVERHEAD;
const PAGE_BYTES = 4 * 1024 * 1024;
const AFTER = /^e\/\d{13}(-[0-9a-f]{16})?$/;

type Ctx = { req: Request; env: Env; url: URL };

const isClaimed = async (env: Env) => (await env.DATA.head('meta/claimed')) !== null;
const credIds = async (env: Env) => (await listAll(env.DATA, 'cred/')).map((o) => o.key.slice('cred/'.length));

/** Workers Rate Limiting, keyed by endpoint group and client IP (Cloudflare sets CF-Connecting-IP). */
async function limit({ req, env }: Ctx, group: string): Promise<void> {
  if (!env.AUTH_LIMITER) return;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await env.AUTH_LIMITER.limit({ key: `${group}:${ip}` })).success) fail(429);
}

/** Checks the recovery auth token against the current recovery verifier (constant time). */
async function recoveryTokenMatches(env: Env, authToken: string): Promise<boolean> {
  const current = await currentRecovery(env.DATA);
  const token = fromB64u(authToken);
  return current !== null && token !== null && (await sameSecret(toB64u(await sha256(token)), current.record.authVerifier));
}

/**
 * Verifies a step-up proof for `purpose`: a passkey assertion over a step-up challenge issued to this
 * session for this purpose (at most 5 minutes old), or, for registration only, the recovery auth token.
 * Returns the challenge to burn once everything else has verified (null for the recovery token).
 */
async function verifyStepUp(env: Env, session: Session, input: StepUpInput, purpose: StepUpPurpose): Promise<string | null> {
  if ('authToken' in input) {
    if (purpose !== 'register' || !(await recoveryTokenMatches(env, input.authToken))) fail(401);
    return null;
  }
  const c = await readChallenge(env, input.challengeToken, 'stepup');
  if (c.purpose !== purpose || c.sid !== session.sid) fail(401);
  const id = input.response.id;
  const cred = (await getJson<Credential>(env.DATA, `cred/${id}`)) ?? fail(401);
  if (!(await verifyLogin(env, input.response, c.ch, id, cred))) fail(401);
  return c.ch;
}

// ---- routes -----------------------------------------------------------------

const routes: Record<string, (c: Ctx) => Promise<Response>> = {
  'GET /api/status': async ({ env }) => json({ claimed: await isClaimed(env) }),

  'POST /api/register/options': async (c) => {
    await limit(c, 'register');
    const body = await readJson(c.req, MAX_JSON);
    let via: 'setup' | 'session' = 'session';
    if (!(await requireSession(c.req, c.env).catch(() => null))) {
      const code = c.env.SETUP_CODE ?? '';
      const ok = typeof body.setupCode === 'string' && code.length >= 16 && (await sameSecret(body.setupCode, code));
      if (!ok || (await isClaimed(c.env))) fail(401);
      via = 'setup';
    }
    const { challenge, token } = await newChallenge(c.env, 'register', { via });
    return json({ options: await registrationOptions(c.env, challenge, await credIds(c.env)), challengeToken: token });
  },

  'POST /api/register/verify': async (c) => {
    await limit(c, 'register');
    const { env } = c;
    const body = await readJson(c.req, MAX_JSON);
    // Validate everything before the first write, so a bad request can't leave a half-claimed vault.
    const response = credentialResponse(body.response, ['clientDataJSON', 'attestationObject']);
    const prfSalt = b64u(body.prfSalt, 32);
    const credentialKey = credentialKeyInput(body.credentialKey);
    const delivery = deliveryInput(body.delivery);
    const deliveryEpoch = posInt(obj(body.delivery).epoch);
    const claimed = await isClaimed(env);
    if (claimed && body.claim !== undefined) fail(409);
    const claim = claimed ? undefined : { vaultId: vaultId(obj(body.claim).vaultId), recovery: recoveryInput(obj(body.claim).recovery) };
    const { ch, via } = await readChallenge(env, body.challengeToken, 'register');
    let stepUpCh: string | null = null;
    if (claimed) {
      // Adding a passkey needs a live session AND a fresh proof (passkey assertion or recovery token).
      if (via !== 'session') fail(401);
      const session = await requireSession(c.req, env);
      if (body.stepUp === undefined) fail(401);
      stepUpCh = await verifyStepUp(env, session, stepUpInput(body.stepUp), 'register');
    } else if (via !== 'setup') fail(401);
    // New keys are always for the current epoch (1 at the claim).
    const epoch = claimed ? await currentEpoch(env.DATA) : 1;
    if (credentialKey.epoch !== epoch || deliveryEpoch !== epoch) fail(409);
    if ((await env.DATA.head(`cred/${response.id}`)) !== null) fail(409);
    const cred = (await verifyRegistration(env, response, ch)) ?? fail(400);
    await burnChallenge(env, ch);
    if (stepUpCh !== null) await burnChallenge(env, stepUpCh);

    const now = new Date().toISOString();
    if (claim) {
      // meta/claimed is the lock: of two racing first registrations, only one gets past it.
      await putNew(env.DATA, 'meta/claimed', JSON.stringify({ vaultId: claim.vaultId, claimedAt: now }));
      await putNew(env.DATA, recoveryKey(1), JSON.stringify({ ...claim.recovery, createdAt: now }));
    }
    await putNew(env.DATA, deliveryKey(epoch, cred.id), JSON.stringify({ ...delivery, createdAt: now }));
    const record: Credential = { publicKey: cred.publicKey, transports: cred.transports, createdAt: now, prfSalt, credentialKey };
    await putNew(env.DATA, `cred/${cred.id}`, JSON.stringify(record));
    return json({ credentialId: cred.id }, 201, { 'Set-Cookie': await sessionCookie(env, { kind: 'passkey', cid: cred.id }) });
  },

  'POST /api/login/options': async ({ req, env }) => {
    await readJson(req, MAX_JSON);
    const { challenge, token } = await newChallenge(env, 'login');
    return json({ options: await loginOptions(env, challenge), challengeToken: token });
  },

  'POST /api/login/verify': async (c) => {
    await limit(c, 'login');
    const { env } = c;
    const body = await readJson(c.req, MAX_JSON);
    const response = credentialResponse(body.response, ['clientDataJSON', 'authenticatorData', 'signature']);
    const id = response.id;
    const { ch } = await readChallenge(env, body.challengeToken, 'login');
    const cred = (await getJson<Credential>(env.DATA, `cred/${id}`)) ?? fail(401);
    const meta = (await getJson<Claimed>(env.DATA, 'meta/claimed')) ?? fail(401);
    if (!(await verifyLogin(env, response, ch, id, cred))) fail(401);
    await burnChallenge(env, ch);
    const epoch = await currentEpoch(env.DATA);
    const found = (await newestDelivery(env.DATA, id, epoch)) ?? fail(500);
    const out = {
      vaultId: meta.vaultId,
      credential: { prfSalt: cred.prfSalt, ...cred.credentialKey },
      keys: { epoch, delivery: { epoch: found.epoch, ephemeralPublicKey: found.delivery.ephemeralPublicKey, wrappedDk: found.delivery.wrappedDk }, history: await history(env.DATA, found.epoch) },
    };
    return json(out, 200, { 'Set-Cookie': await sessionCookie(env, { kind: 'passkey', cid: id }) });
  },

  'POST /api/stepup/options': async (c) => {
    const session = await requireSession(c.req, c.env, 'passkey');
    const purpose = (await readJson(c.req, MAX_JSON)).purpose;
    if (purpose !== 'register' && purpose !== 'rotate') fail(400);
    const { challenge, token } = await newChallenge(c.env, 'stepup', { purpose: purpose as string, sid: session.sid });
    return json({ options: await loginOptions(c.env, challenge), challengeToken: token });
  },

  'GET /api/credentials': async (c) => {
    await requireSession(c.req, c.env, 'passkey');
    const current = await currentEpoch(c.env.DATA);
    // Each passkey's binding under the CURRENT data key: from its registration in this epoch, or from
    // the rotation that started it. A passkey with neither is returned with its old binding, and the
    // app refuses to rotate (only key holders of the current epoch can vouch for a passkey).
    const credentials = await Promise.all((await credIds(c.env)).map(async (id) => {
      const cred = (await getJson<Credential>(c.env.DATA, `cred/${id}`)) ?? fail(500);
      const { publicKey, epoch, binding } = cred.credentialKey;
      if (epoch !== current) {
        const rebound = (await getJson<Delivery>(c.env.DATA, deliveryKey(current, id)))?.binding;
        if (rebound !== undefined) return { id, publicKey, epoch: current, binding: rebound };
      }
      return { id, publicKey, epoch, binding };
    }));
    return json({ credentials });
  },

  'GET /api/keys': async (c) => {
    await requireSession(c.req, c.env, 'passkey');
    const id = credentialId(c.url.searchParams.get('credential') ?? '');
    const epoch = await currentEpoch(c.env.DATA);
    const found = await newestDelivery(c.env.DATA, id, epoch);
    const delivery = found ? { epoch: found.epoch, ephemeralPublicKey: found.delivery.ephemeralPublicKey, wrappedDk: found.delivery.wrappedDk } : null;
    return json({ epoch, delivery, history: found ? await history(c.env.DATA, found.epoch) : null });
  },

  'GET /api/recovery/params': async ({ env }) => {
    const meta = (await getJson<Claimed>(env.DATA, 'meta/claimed')) ?? fail(404);
    const current = (await currentRecovery(env.DATA)) ?? fail(404);
    return json({ vaultId: meta.vaultId, version: current.version, salt: current.record.salt });
  },

  'POST /api/recovery/login': async (c) => {
    await limit(c, 'recovery');
    const { env } = c;
    const authToken = b64u((await readJson(c.req, MAX_JSON)).authToken, 32);
    const current = (await currentRecovery(env.DATA)) ?? fail(401);
    if (!(await recoveryTokenMatches(env, authToken))) fail(401);
    const out = { wrappedDk: current.record.wrappedDk, version: current.version, history: await history(env.DATA, current.version) };
    return json(out, 200, { 'Set-Cookie': await sessionCookie(env, { kind: 'recovery', rv: current.version }) });
  },

  'POST /api/recovery/rotate': async (c) => {
    const { env } = c;
    const session = await requireSession(c.req, env, 'passkey');
    const body = await readJson(c.req, MAX_JSON);
    const current = (await currentRecovery(env.DATA)) ?? fail(409);
    const version = current.version + 1;
    if (body.version !== version) fail(409);
    const recovery = recoveryInput(body);
    const hist = historyCt(body.history, version);
    const given = obj(body.deliveries);
    const ids = await credIds(env);
    // Every registered passkey gets the new data key, or the rotation is refused.
    if (Object.keys(given).length !== ids.length || !ids.every((id) => Object.hasOwn(given, id))) fail(409);
    const deliveries = ids.map((id) => [id, rotationDeliveryInput(given[id])] as const);
    if (body.stepUp === undefined) fail(401);
    const stepUp = stepUpInput(body.stepUp);
    if ('authToken' in stepUp) fail(401);
    const ch = (await verifyStepUp(env, session, stepUp, 'rotate')) as string;
    await burnChallenge(env, ch);

    const now = new Date().toISOString();
    // The history object is the lock: of two racing rotations, only one gets past it.
    await putNew(env.DATA, historyKey(version), hist);
    for (const [id, d] of deliveries) await putNew(env.DATA, deliveryKey(version, id), JSON.stringify({ ...d, createdAt: now }));
    // Written last: the new epoch becomes current only once its keys are all in place.
    await putNew(env.DATA, recoveryKey(version), JSON.stringify({ ...recovery, createdAt: now }));
    return json({ version }, 201);
  },

  'POST /api/blobs': async (c) => {
    await requireSession(c.req, c.env);
    const blob = await readBytes(c.req, MAX_BLOB);
    if (!BLOB_SIZES.has(blob.length) || blob[0] !== BLOB_VERSION) fail(400);
    // Only blobs sealed under the current epoch are accepted (a device behind a rotation re-seals).
    const epoch = new DataView(blob.buffer, blob.byteOffset + 1, 4).getUint32(0);
    if (epoch !== (await currentEpoch(c.env.DATA))) fail(409);
    const key = `e/${String(Date.now()).padStart(13, '0')}-${[...randomBytes(8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    await putNew(c.env.DATA, key, blob);
    return json({ key }, 201);
  },

  'GET /api/blobs': async (c) => {
    await requireSession(c.req, c.env);
    const after = c.url.searchParams.get('after');
    const limitText = c.url.searchParams.get('limit') ?? '100';
    const n = Number(limitText);
    if ((after !== null && !AFTER.test(after)) || !/^\d{1,3}$/.test(limitText) || n < 1 || n > 200) fail(400);
    const page = await c.env.DATA.list({ prefix: 'e/', limit: n, ...(after ? { startAfter: after } : {}) });
    let budget = PAGE_BYTES;
    const objects = page.objects.filter((o, i) => (budget -= o.size) >= 0 || i === 0);
    const blobs = await Promise.all(objects.map(async ({ key }) => {
      const o = (await c.env.DATA.get(key)) ?? fail(500);
      return { key, data: toB64u(new Uint8Array(await o.arrayBuffer())) };
    }));
    return json({ blobs, more: page.truncated || objects.length < page.objects.length });
  },

  'POST /api/logout': async ({ req, env }) => {
    await readJson(req, MAX_JSON);
    await revoke(req, env);
    return json({}, 200, { 'Set-Cookie': clearedCookie });
  },
};

// ---- entry points -----------------------------------------------------------

async function handle(req: Request, env: Env): Promise<Response> {
  if (!configOk(env)) fail(500);
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
    // Counts only: no keys, sizes or timings that could describe the data.
    console.log(`backup: copied ${await backup(env)} object(s)`);
  },
} satisfies ExportedHandler<Env>;
