// Runs the real Worker (worker/wrangler.jsonc) in workerd with local R2 and static
// assets, via wrangler's test harness. Only the assets folder, vars and secrets differ.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { createTestHarness, type TestHarness } from 'wrangler';
import { b64u, SoftAuthenticator } from './authenticator.ts';

export const WORKER_DIR = resolve(import.meta.dirname, '..');
export const ORIGIN = 'https://basis.example.test';
export const RP_ID = 'basis.example.test';
export const SESSION_SECRET = 'test-session-secret-0123456789-abcdefghij';
export const SETUP_CODE = 'test-setup-code-0123456789';

/** The real wrangler.jsonc, parsed (it's JSONC). */
export function wranglerConfig(): Record<string, unknown> & { assets: Record<string, unknown>; vars: Record<string, string> } {
  const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(join(WORKER_DIR, 'wrangler.jsonc'), 'utf8'));
  if (error) throw new Error('wrangler.jsonc does not parse');
  return config;
}

/** A small static site standing in for app/dist, with the real app/public/_headers. */
function fakeAssets(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bb-assets-'));
  copyFileSync(resolve(WORKER_DIR, '../app/public/_headers'), join(dir, '_headers'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Bitcoin Basis</title><script type="module" src="/app.js"></script>');
  writeFileSync(join(dir, 'app.js'), 'console.log("app");');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-0123abcd.js'), 'console.log("chunk");');
  writeFileSync(join(dir, 'assets', 'index-0123abcd.css'), 'body{margin:0}');
  return dir;
}

/** `vars` are added to (or override) the test vars, e.g. MEMPOOL_URL pointing at a local fake. */
export function startServer(vars: Record<string, string> = {}): TestHarness {
  const raw = wranglerConfig();
  delete raw.$schema;
  return createTestHarness({
    root: WORKER_DIR,
    workers: [{
      config: {
        ...raw,
        main: join(WORKER_DIR, 'src/index.ts'),
        assets: { ...raw.assets, directory: fakeAssets() },
        vars: { ...raw.vars, ORIGIN, RP_ID, SESSION_SECRET, SETUP_CODE, ...vars },
      },
    }],
  });
}

const rand = (n: number) => b64u(randomBytes(n));
export const sha256b64u = (b: Uint8Array) => b64u(createHash('sha256').update(b).digest());

/** Fake app-side key material in the exact shapes the protocol requires. */
export function fakeVault() {
  const authToken = randomBytes(32);
  return {
    vaultId: rand(16),
    authToken: b64u(authToken),
    recovery: { salt: rand(32), authVerifier: sha256b64u(authToken), wrappedDk: rand(60) },
  };
}

/** An uncompressed P-256 public key shape (0x04 || 64 bytes). The server can't check the curve point. */
export const fakeEcKey = () => {
  const b = new Uint8Array(randomBytes(65));
  b[0] = 4;
  return b64u(b);
};

/** A credential's key material in the shapes the protocol requires, for epoch `epoch`. */
export const fakeCredentialKeys = (epoch = 1) => ({
  prfSalt: rand(32),
  credentialKey: { publicKey: fakeEcKey(), wrappedPrivateKey: rand(12 + 138 + 16), epoch, binding: rand(28) },
  delivery: { epoch, ephemeralPublicKey: fakeEcKey(), wrappedDk: rand(60) },
});

/** A sealed blob of a valid size: version byte 2, the epoch (4 bytes, big-endian), then random bytes. */
export function fakeBlob(bucketKiB = 1, epoch = 1): Uint8Array {
  const b = new Uint8Array(randomBytes(bucketKiB * 1024 + 33));
  b[0] = 2;
  new DataView(b.buffer).setUint32(1, epoch);
  return b;
}

/** Fake rotation body for `version` (epoch) with deliveries for the given credential ids. */
export function fakeRotation(version: number, credIds: string[]) {
  const next = fakeVault();
  return {
    next,
    body: {
      version,
      ...next.recovery,
      history: rand(12 + 32 * (version - 1) + 16),
      deliveries: Object.fromEntries(credIds.map((id) => [id, { ephemeralPublicKey: fakeEcKey(), wrappedDk: rand(60), binding: rand(28) }])),
    },
  };
}

/** Signs a token exactly like the Worker does, to forge expired or tampered ones in tests. */
export function forgeToken(payload: Record<string, unknown>, secret = SESSION_SECRET): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`;
}

type Init = { origin?: string | null; type?: string | null; cookie?: string };

/** A browser-like client: same origin, JSON bodies, keeps the session cookie. */
export const COOKIE = '__Secure-bb_session';

export class Client {
  cookie: string | undefined;
  /** Each client looks like its own IP to the rate limiter (Cloudflare sets CF-Connecting-IP). */
  ip = `198.51.100.${randomBytes(1)[0]}-${rand(6)}`;
  constructor(private readonly server: TestHarness) {}

  async request(method: string, path: string, body?: unknown, init: Init = {}) {
    const headers: Record<string, string> = { 'CF-Connecting-IP': this.ip };
    const origin = init.origin === undefined ? ORIGIN : init.origin;
    if (origin !== null) headers.Origin = origin;
    const raw = body instanceof Uint8Array;
    const type = init.type === undefined ? (raw ? 'application/octet-stream' : 'application/json') : init.type;
    if (type !== null && method !== 'GET') headers['Content-Type'] = type;
    const cookie = init.cookie ?? this.cookie;
    if (cookie) headers.Cookie = cookie;
    const res = await this.server.fetch(`http://localhost${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    });
    const setCookie = res.headers.get('Set-Cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    // Tests read deep into responses (e.g. data.options.challenge); `any` keeps them readable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = res.headers.get('Content-Type')?.startsWith('application/json') ? JSON.parse(text) : text;
    return { status: res.status, headers: res.headers, setCookie, data };
  }

  get = (path: string, init?: Init) => this.request('GET', path, undefined, init);
  post = (path: string, body?: unknown, init?: Init) => this.request('POST', path, body ?? {}, init);

  async registerOptions(body: Record<string, unknown> = {}) {
    return this.post('/api/register/options', body);
  }

  /** Full registration ceremony with a software authenticator (no step-up: add `stepUp` in `extra`). */
  async register(auth: SoftAuthenticator, extra: Record<string, unknown> = {}, optionsBody: Record<string, unknown> = {}, epoch = 1) {
    const opts = await this.registerOptions(optionsBody);
    if (opts.status !== 200) return opts;
    const response = auth.register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
    return this.post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys(epoch), ...extra });
  }

  /** A fresh step-up assertion `{ response, challengeToken }` from `auth` for `purpose`. */
  async stepUp(auth: SoftAuthenticator, purpose: 'register' | 'rotate') {
    const opts = await this.post('/api/stepup/options', { purpose });
    if (opts.status !== 200) throw new Error(`step-up options: ${opts.status}`);
    return { response: auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge }), challengeToken: opts.data.challengeToken };
  }

  /** Adds `added` as a passkey, stepping up with the already registered `existing`. */
  async addPasskey(added: SoftAuthenticator, existing: SoftAuthenticator, extra: Record<string, unknown> = {}, epoch = 1) {
    return this.register(added, { stepUp: await this.stepUp(existing, 'register'), ...extra }, {}, epoch);
  }

  async login(auth: SoftAuthenticator) {
    const opts = await this.post('/api/login/options');
    const response = auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
    return this.post('/api/login/verify', { response, challengeToken: opts.data.challengeToken });
  }
}

/** Claims a fresh vault with the setup code. Returns a logged-in client and its authenticator. */
export async function claimVault(server: TestHarness) {
  const client = new Client(server);
  const auth = new SoftAuthenticator();
  const vault = fakeVault();
  const res = await client.register(auth, { claim: { vaultId: vault.vaultId, recovery: vault.recovery } }, { setupCode: SETUP_CODE });
  if (res.status !== 201) throw new Error(`claim failed: ${res.status} ${JSON.stringify(res.data)}`);
  return { client, auth, vault };
}
