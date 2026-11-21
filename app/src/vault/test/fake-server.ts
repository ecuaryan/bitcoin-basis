/**
 * An in-memory server that follows docs/sync-protocol.md closely enough to test the client:
 * setup-code claim, challenge tokens (single use, purpose-bound), revocable passkey and recovery
 * sessions (cookies per client), step-up for registration and rotation, data-key epochs (deliveries,
 * histories, epoch-checked uploads), only-if-new storage, bucket-size checks and paged listing.
 * It does not verify WebAuthn signatures (the real Worker does, with @simplewebauthn/server).
 */
import { fromBase64Url, fromUtf8, randomBytes, toBase64Url, toBytes, toHex, type Bytes } from '../bytes.ts';
import { blobEpoch, isValidBlobSize } from '../seal.ts';

export interface StoredCred {
  publicKey: string;
  prfSalt: string;
  credentialKey: { publicKey: string; wrappedPrivateKey: string; epoch: number; binding: string };
}
export interface StoredRecovery {
  salt: string;
  authVerifier: string;
  wrappedDk: string;
}
export interface StoredDelivery {
  ephemeralPublicKey: string;
  wrappedDk: string;
  /** Rotations only: the credential re-bound under that epoch's key. */
  binding?: string;
}

export interface FakeClient {
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Simulate no connectivity for this client. */
  offline: boolean;
  /** Blob listing requests never answer (a slow or hanging network). */
  hangList: boolean;
  /** Requests whose path matches never answer, and ignore their abort signal (a server that went quiet). */
  hang: ((path: string) => boolean) | null;
  /** Drop this client's session cookie (expired). */
  expireSession(): void;
  /** The raw cookie value (a stolen copy, for tests). */
  readonly cookie: string | null;
  /** Replace the cookie (replay a stolen one, for tests). */
  setCookie(cookie: string | null): void;
}

interface Session {
  kind: 'passkey' | 'recovery';
  cid?: string;
  rv?: number;
}

type Result = { status: number; json?: unknown; session?: Session | 'clear' };

export class FakeServer {
  claimed: { vaultId: string } | null = null;
  readonly creds = new Map<string, StoredCred>();
  readonly recovery = new Map<number, StoredRecovery>();
  /** `<epoch>/<credentialId>` → delivery. */
  readonly deliveries = new Map<string, StoredDelivery>();
  /** epoch → history (base64url). */
  readonly histories = new Map<number, string>();
  readonly blobs = new Map<string, Bytes>();
  /** Revoked session ids (the cookie value stands in for the id). */
  readonly revoked = new Set<string>();
  /** Every request body seen (for "nothing secret is sent" checks). */
  readonly requests: { path: string; body: string | Bytes }[] = [];
  /** Page size cap (the real server allows up to 200). */
  maxPage = 200;
  /** Answer requests to these paths with this status (e.g. 503) until removed. */
  readonly failing = new Map<string, number>();
  /** Server clock for blob keys (ms). Tests may move it to model a slow upload. */
  clock = 1_800_000_000_000;
  /**
   * The Bitcoin price the Worker would pass on from mempool.space, in cents per BTC: `GET /api/price` answers
   * `priceCents`, `GET /api/price/history?ts=` answers `priceAt(ts)` (null: no price, 404). Fixed, so tests never drift.
   */
  priceCents = 9_500_000;
  /**
   * When set, `GET /api/price` answers as the Worker does while mempool is down and it still has the last good
   * price: `priceCents` from this time (ms), marked stale. Otherwise the answer is from now.
   */
  priceKeptAt: number | null = null;
  priceAt: (unixSeconds: number) => number | null = () => this.priceCents;
  private readonly sessions = new Map<string, Session>();
  private readonly challenges = new Map<string, { challenge: string; type: 'create' | 'get'; purpose?: string; cookie?: string }>();

  constructor(readonly setupCode: string) {}

  client(): FakeClient {
    let cookie: string | null = null;
    const c: FakeClient = {
      offline: false,
      hangList: false,
      hang: null,
      expireSession: () => {
        cookie = null;
      },
      get cookie() {
        return cookie;
      },
      setCookie: (v) => {
        cookie = v;
      },
      fetch: async (input, init) => {
        if (c.offline) throw new TypeError('fetch failed');
        if (c.hang?.(input) === true) return new Promise<Response>(() => undefined);
        if (c.hangList && (init.method ?? 'GET') === 'GET' && input.startsWith('/api/blobs')) return new Promise<Response>(() => undefined);
        if (init.credentials !== 'same-origin') throw new Error('fake server: credentials must be same-origin');
        const res = await this.handle(input, init, cookie);
        if (res.session === 'clear') cookie = null;
        else if (res.session !== undefined) {
          cookie = toHex(randomBytes(16));
          this.sessions.set(cookie, res.session);
        }
        return new Response(res.json === undefined ? null : JSON.stringify(res.json), { status: res.status, headers: { 'Content-Type': 'application/json' } });
      },
    };
    return c;
  }

  /** Sorted blob keys. */
  keys(): string[] {
    return [...this.blobs.keys()].sort();
  }

  /** The current recovery version = data-key epoch (0 before the claim). */
  epoch(): number {
    const vs = [...this.recovery.keys()];
    return vs.length === 0 ? 0 : Math.max(...vs);
  }

  private live(cookie: string | null): Session | null {
    if (cookie === null || this.revoked.has(cookie)) return null;
    const s = this.sessions.get(cookie);
    if (s === undefined) return null;
    if (s.kind === 'recovery' && s.rv !== this.epoch()) return null;
    return s;
  }

  private newestDelivery(credId: string): { epoch: number; ephemeralPublicKey: string; wrappedDk: string } | null {
    for (let e = this.epoch(); e >= 1; e--) {
      const d = this.deliveries.get(`${e}/${credId}`);
      if (d !== undefined) return { epoch: e, ...d };
    }
    return null;
  }

  private async recoveryTokenOk(authToken: unknown): Promise<boolean> {
    const rec = this.recovery.get(this.epoch());
    if (rec === undefined || !isB64u(authToken, 32)) return false;
    return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(authToken as string)))) === rec.authVerifier;
  }

  private async handle(input: string, init: RequestInit, cookie: string | null): Promise<Result> {
    const url = new URL(input, 'https://basis.example');
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    const failure = this.failing.get(url.pathname);
    if (failure !== undefined) return { status: failure, json: { error: 'injected' } };
    const session = this.live(cookie);
    let body: unknown = null;
    if (method !== 'GET') {
      const ct = headers['Content-Type'];
      if (url.pathname === '/api/blobs') {
        if (ct !== 'application/octet-stream') return { status: 415 };
        const raw = toBytes(init.body as Uint8Array);
        this.requests.push({ path: url.pathname, body: raw });
        body = raw;
      } else {
        if (ct !== 'application/json') return { status: 415 };
        this.requests.push({ path: url.pathname, body: init.body as string });
        body = JSON.parse(init.body as string) as unknown;
      }
    }
    const b = body as Record<string, unknown>;
    switch (`${method} ${url.pathname}`) {
      case 'GET /api/status':
        return { status: 200, json: { claimed: this.claimed !== null } };
      case 'GET /api/price':
        return { status: 200, json: this.priceKeptAt === null ? { usdCents: this.priceCents, asOf: Date.now(), source: 'mempool' } : { usdCents: this.priceCents, asOf: this.priceKeptAt, source: 'mempool', stale: true } };
      case 'GET /api/price/history': {
        const ts = Number(url.searchParams.get('ts'));
        const cents = Number.isSafeInteger(ts) && ts > 0 ? this.priceAt(Math.floor(ts / 3600) * 3600) : null;
        return cents === null ? { status: 404, json: { error: 'no price' } } : { status: 200, json: { usdCents: cents } };
      }
      case 'POST /api/register/options': {
        if (session === null) {
          if (this.claimed !== null) return { status: 401 };
          if (b.setupCode !== this.setupCode) return { status: 401 };
        }
        const challenge = toBase64Url(randomBytes(32));
        const challengeToken = toBase64Url(randomBytes(16));
        this.challenges.set(challengeToken, { challenge, type: 'create' });
        return {
          status: 200,
          json: {
            challengeToken,
            options: {
              rp: { id: 'basis.example', name: 'Bitcoin Basis' },
              user: { id: toBase64Url(randomBytes(16)), name: 'owner', displayName: 'Bitcoin Basis' },
              challenge,
              pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
              authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
              excludeCredentials: [...this.creds.keys()].map((id) => ({ id, type: 'public-key' })),
              extensions: { prf: {} },
            },
          },
        };
      }
      case 'POST /api/register/verify': {
        const claim = b.claim as { vaultId: string; recovery: StoredRecovery } | undefined;
        if (claim !== undefined && this.claimed !== null) return { status: 409 };
        if (claim === undefined && this.claimed === null) return { status: 400 };
        const response = b.response as { id: string; rawId: string; type: string; response: { clientDataJSON: string; publicKey?: string } };
        const key = b.credentialKey as StoredCred['credentialKey'] | undefined;
        const delivery = b.delivery as (StoredDelivery & { epoch: number }) | undefined;
        if (!isB64u(b.prfSalt, 32) || !key || !isB64u(key.publicKey, 65) || !isB64u(key.binding, 28) || typeof key.wrappedPrivateKey !== 'string') return { status: 400 };
        if (!delivery || !isB64u(delivery.ephemeralPublicKey, 65) || !isB64u(delivery.wrappedDk, 60)) return { status: 400 };
        if (claim !== undefined && (!isB64u(claim.vaultId, 16) || !isB64u(claim.recovery.salt, 32) || !isB64u(claim.recovery.authVerifier, 32) || !isB64u(claim.recovery.wrappedDk, 60))) return { status: 400 };
        let stepUpToken: string | null = null;
        if (claim === undefined) {
          if (session === null) return { status: 401 };
          const stepUp = b.stepUp as { authToken?: string; challengeToken?: string; response?: { id: string; response: { clientDataJSON: string } } } | undefined;
          if (stepUp === undefined) return { status: 401 };
          if (stepUp.authToken !== undefined) {
            if (!(await this.recoveryTokenOk(stepUp.authToken))) return { status: 401 };
          } else {
            if (!this.peekChallenge(stepUp.challengeToken, stepUp.response?.response.clientDataJSON ?? '', 'get', 'register', cookie)) return { status: 401 };
            if (!this.creds.has(stepUp.response?.id ?? '')) return { status: 401 };
            stepUpToken = stepUp.challengeToken as string;
          }
        }
        const epoch = claim === undefined ? this.epoch() : 1;
        if (key.epoch !== epoch || delivery.epoch !== epoch) return { status: 409 };
        if (response.id !== response.rawId || response.type !== 'public-key') return { status: 400 };
        if (this.creds.has(response.id)) return { status: 409 };
        if (!this.peekChallenge(b.challengeToken, response.response.clientDataJSON, 'create')) return { status: 400 };
        this.challenges.delete(b.challengeToken as string);
        if (stepUpToken !== null) this.challenges.delete(stepUpToken);
        if (claim !== undefined) {
          this.claimed = { vaultId: claim.vaultId };
          this.recovery.set(1, claim.recovery);
        }
        this.deliveries.set(`${epoch}/${response.id}`, { ephemeralPublicKey: delivery.ephemeralPublicKey, wrappedDk: delivery.wrappedDk });
        this.creds.set(response.id, { publicKey: response.response.publicKey ?? '', prfSalt: b.prfSalt as string, credentialKey: key });
        return { status: 201, json: { credentialId: response.id }, session: { kind: 'passkey', cid: response.id } };
      }
      case 'POST /api/login/options':
      case 'POST /api/stepup/options': {
        const stepup = url.pathname === '/api/stepup/options';
        if (stepup && (session === null || session.kind !== 'passkey')) return { status: 401 };
        if (stepup && b.purpose !== 'register' && b.purpose !== 'rotate') return { status: 400 };
        const challenge = toBase64Url(randomBytes(32));
        const challengeToken = toBase64Url(randomBytes(16));
        this.challenges.set(challengeToken, { challenge, type: 'get', ...(stepup ? { purpose: b.purpose as string, cookie: cookie as string } : {}) });
        return { status: 200, json: { challengeToken, options: { challenge, rpId: 'basis.example', userVerification: 'required', allowCredentials: [] } } };
      }
      case 'POST /api/login/verify': {
        const response = b.response as { id: string; response: { clientDataJSON: string; signature: string } };
        if (!this.peekChallenge(b.challengeToken, response.response.clientDataJSON, 'get')) return { status: 401 };
        const cred = this.creds.get(response.id);
        if (cred === undefined || this.claimed === null || response.response.signature === '') return { status: 401 };
        this.challenges.delete(b.challengeToken as string);
        const delivery = this.newestDelivery(response.id);
        if (delivery === null) return { status: 500 };
        return {
          status: 200,
          json: {
            vaultId: this.claimed.vaultId,
            credential: { prfSalt: cred.prfSalt, ...cred.credentialKey },
            keys: { epoch: this.epoch(), delivery, history: this.histories.get(delivery.epoch) ?? null },
          },
          session: { kind: 'passkey', cid: response.id },
        };
      }
      case 'GET /api/credentials': {
        if (session?.kind !== 'passkey') return { status: 401 };
        const current = this.epoch();
        return {
          status: 200,
          json: {
            credentials: [...this.creds].map(([id, c]) => {
              const rebound = c.credentialKey.epoch === current ? undefined : this.deliveries.get(`${current}/${id}`)?.binding;
              return rebound === undefined ? { id, publicKey: c.credentialKey.publicKey, epoch: c.credentialKey.epoch, binding: c.credentialKey.binding } : { id, publicKey: c.credentialKey.publicKey, epoch: current, binding: rebound };
            }),
          },
        };
      }
      case 'GET /api/keys': {
        if (session?.kind !== 'passkey') return { status: 401 };
        const delivery = this.newestDelivery(url.searchParams.get('credential') ?? '');
        return { status: 200, json: { epoch: this.epoch(), delivery, history: delivery === null ? null : (this.histories.get(delivery.epoch) ?? null) } };
      }
      case 'GET /api/recovery/params': {
        const v = this.epoch();
        if (this.claimed === null || v === 0) return { status: 404 };
        return { status: 200, json: { vaultId: this.claimed.vaultId, version: v, salt: (this.recovery.get(v) as StoredRecovery).salt } };
      }
      case 'POST /api/recovery/login': {
        const v = this.epoch();
        if (v === 0 || !(await this.recoveryTokenOk(b.authToken))) return { status: 401 };
        const rec = this.recovery.get(v) as StoredRecovery;
        return { status: 200, json: { wrappedDk: rec.wrappedDk, version: v, history: this.histories.get(v) ?? null }, session: { kind: 'recovery', rv: v } };
      }
      case 'POST /api/recovery/rotate': {
        if (session?.kind !== 'passkey') return { status: 401 };
        const v = this.epoch() + 1;
        if (b.version !== v) return { status: 409 };
        if (!isB64u(b.salt, 32) || !isB64u(b.authVerifier, 32) || !isB64u(b.wrappedDk, 60) || !isB64u(b.history, 12 + 32 * (v - 1) + 16)) return { status: 400 };
        const deliveries = b.deliveries as Record<string, StoredDelivery>;
        const ids = [...this.creds.keys()];
        if (Object.keys(deliveries).length !== ids.length || !ids.every((id) => Object.hasOwn(deliveries, id))) return { status: 409 };
        if (!ids.every((id) => isB64u(deliveries[id]?.binding, 28))) return { status: 400 };
        const stepUp = b.stepUp as { challengeToken?: string; response?: { id: string; response: { clientDataJSON: string } } } | undefined;
        if (!stepUp || !this.peekChallenge(stepUp.challengeToken, stepUp.response?.response.clientDataJSON ?? '', 'get', 'rotate', cookie)) return { status: 401 };
        if (!this.creds.has(stepUp.response?.id ?? '')) return { status: 401 };
        this.challenges.delete(stepUp.challengeToken as string);
        this.histories.set(v, b.history as string);
        for (const id of ids) this.deliveries.set(`${v}/${id}`, deliveries[id] as StoredDelivery);
        this.recovery.set(v, { salt: b.salt as string, authVerifier: b.authVerifier as string, wrappedDk: b.wrappedDk as string });
        return { status: 201, json: { version: v } };
      }
      case 'POST /api/blobs': {
        if (session === null) return { status: 401 };
        const raw = body as Bytes;
        if (!isValidBlobSize(raw.length) || raw[0] !== 2) return { status: 400 };
        if (blobEpoch(raw) !== this.epoch()) return { status: 409 };
        const key = `e/${String(this.clock++).padStart(13, '0')}-${toHex(randomBytes(8))}`;
        this.blobs.set(key, raw);
        return { status: 201, json: { key } };
      }
      case 'GET /api/blobs': {
        if (session === null) return { status: 401 };
        const after = url.searchParams.get('after');
        if (after !== null && !/^e\/\d{13}/.test(after)) return { status: 400 };
        const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 200, this.maxPage);
        const keys = this.keys().filter((k) => after === null || k > after);
        const page = keys.slice(0, limit);
        return { status: 200, json: { blobs: page.map((key) => ({ key, data: toBase64Url(this.blobs.get(key) as Bytes) })), more: keys.length > page.length } };
      }
      case 'POST /api/logout':
        if (cookie !== null && this.sessions.has(cookie)) this.revoked.add(cookie);
        return { status: 200, json: {}, session: 'clear' };
      default:
        return { status: 404 };
    }
  }

  /** Checks a challenge token (purpose, session, clientData) without spending it. */
  private peekChallenge(token: unknown, clientDataJSON: string, type: 'create' | 'get', purpose?: string, cookie?: string | null): boolean {
    if (typeof token !== 'string') return false;
    const c = this.challenges.get(token);
    if (c === undefined || c.type !== type || c.purpose !== purpose) return false;
    if (purpose !== undefined && c.cookie !== cookie) return false;
    const data = JSON.parse(fromUtf8(fromBase64Url(clientDataJSON))) as { type: string; challenge: string };
    return data.type === `webauthn.${type}` && data.challenge === c.challenge;
  }
}

function isB64u(v: unknown, bytes: number): boolean {
  if (typeof v !== 'string' || /[+/=]/.test(v)) return false;
  try {
    return fromBase64Url(v).length === bytes;
  } catch {
    return false;
  }
}
