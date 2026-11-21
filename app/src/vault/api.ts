/**
 * Typed client for the sync Worker's API (docs/sync-protocol.md, "API").
 *
 * Same origin only: relative URLs, `credentials: 'same-origin'` (the session is an HttpOnly
 * cookie), JSON bodies except the blob upload. Binary fields in JSON are unpadded base64url
 * (the decoder also accepts standard base64).
 * Every failure is an `ApiError` with a `kind` the vault can act on. Every request has a timeout
 * (default 15 s, uploads 60 s), so a stalled connection becomes a `timeout` error, never a hang.
 */
import { linkedController, raceAbort } from './abort.ts';
import { fromBase64Url, type Bytes } from './bytes.ts';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from './passkey.ts';

export type ApiErrorKind =
  /** No response at all (offline, DNS, CORS). */
  | 'network'
  /** No answer in time: a slow server or a stalled connection (e.g. a phone just back from the background). */
  | 'timeout'
  /** The caller gave up (its `AbortSignal` fired). */
  | 'aborted'
  | 'bad-request'
  /** 401: no session, or wrong recovery token. */
  | 'unauthorized'
  /** 403: wrong origin, setup code, or vault already claimed. */
  | 'forbidden'
  | 'not-found'
  /** 409: the key already exists (only-if-new write). */
  | 'conflict'
  | 'too-large'
  | 'rate-limited'
  | 'server'
  /** The server answered, but not with what the protocol says. */
  | 'bad-response';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? `API ${kind}${status === null ? '' : ` (${status})`}`, options);
  }
}

export interface ChallengeOptions<T> {
  readonly options: T;
  readonly challengeToken: string;
}

export interface RecoveryRecordInput {
  readonly salt: string;
  readonly authVerifier: string;
  readonly wrappedDk: string;
}

/** A DK delivered to one passkey's ECDH key. */
export interface DeliveryInput {
  readonly ephemeralPublicKey: string;
  readonly wrappedDk: string;
}

export interface DeliveryJSON extends DeliveryInput {
  readonly epoch: number;
}

/** A passkey's ECDH key as the server stores it (`binding` proves a key holder registered it). */
export interface CredentialKeyJSON {
  readonly publicKey: string;
  readonly wrappedPrivateKey: string;
  readonly epoch: number;
  readonly binding: string;
}

/** Step-up proof: a fresh passkey assertion over a step-up challenge, or (registration only) the recovery auth token. */
export type StepUp = { readonly response: AuthenticationResponseJSON; readonly challengeToken: string } | { readonly authToken: string };

export interface RegisterVerifyBody {
  readonly response: RegistrationResponseJSON;
  readonly challengeToken: string;
  readonly prfSalt: string;
  readonly credentialKey: CredentialKeyJSON;
  readonly delivery: DeliveryJSON;
  readonly claim?: { readonly vaultId: string; readonly recovery: RecoveryRecordInput };
  /** Required for every registration after the claim. */
  readonly stepUp?: StepUp;
}

/** The current epoch and the newest delivery (and its epoch's history) for one credential. */
export interface EpochKeys {
  readonly epoch: number;
  readonly delivery: DeliveryJSON | null;
  readonly history: string | null;
}

export interface LoginResult {
  readonly vaultId: string;
  readonly credential: CredentialKeyJSON & { readonly prfSalt: string };
  readonly keys: EpochKeys & { readonly delivery: DeliveryJSON };
}

export interface RecoveryLoginResult {
  readonly wrappedDk: string;
  readonly version: number;
  readonly history: string | null;
}

export interface RotateBody extends RecoveryRecordInput {
  /** The new version = the new epoch (current + 1); the client needs it for the AADs. */
  readonly version: number;
  /** The new epoch's history: every older DK sealed under the new one. */
  readonly history: string;
  /** The new DK for every registered passkey, by credential id, with the passkey re-bound under the new DK. */
  readonly deliveries: Readonly<Record<string, DeliveryInput & { readonly binding: string }>>;
  readonly stepUp: StepUp;
}

export interface ServerCredential {
  readonly id: string;
  readonly publicKey: string;
  readonly epoch: number;
  readonly binding: string;
}

export interface RecoveryParams {
  readonly vaultId: string;
  readonly version: number;
  readonly salt: string;
}

export interface RemoteBlob {
  readonly key: string;
  readonly data: Bytes;
}

export interface BlobPage {
  readonly blobs: readonly RemoteBlob[];
  readonly more: boolean;
}

export const MAX_PAGE = 200;

/** Per-call options: the caller's cancel signal and a tighter timeout (the client's default otherwise). */
export interface RequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

/** The server can't be reached right now (offline, or too slow): the vault falls back to the local copy. */
export function isUnreachable(e: unknown): boolean {
  return e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout');
}

export interface ApiClient {
  status(): Promise<{ claimed: boolean }>;
  registerOptions(auth: { setupCode: string } | null): Promise<ChallengeOptions<PublicKeyCredentialCreationOptionsJSON>>;
  /** Stores the credential and starts a session (cookie). */
  registerVerify(body: RegisterVerifyBody): Promise<{ credentialId: string }>;
  loginOptions(opts?: RequestOptions): Promise<ChallengeOptions<PublicKeyCredentialRequestOptionsJSON>>;
  loginVerify(body: { response: AuthenticationResponseJSON; challengeToken: string }, opts?: RequestOptions): Promise<LoginResult>;
  recoveryParams(opts?: RequestOptions): Promise<RecoveryParams>;
  recoveryLogin(authToken: string, opts?: RequestOptions): Promise<RecoveryLoginResult>;
  /** Needs a passkey session and a `rotate` step-up. */
  recoveryRotate(body: RotateBody): Promise<{ version: number }>;
  /** A step-up challenge for this (passkey) session, valid five minutes, for one purpose. */
  stepUpOptions(purpose: 'register' | 'rotate'): Promise<ChallengeOptions<PublicKeyCredentialRequestOptionsJSON>>;
  /** Every registered passkey's ECDH public key and binding (passkey session). */
  credentials(): Promise<ServerCredential[]>;
  /** The current epoch and a credential's newest delivery (passkey session). */
  keys(credentialId: string): Promise<EpochKeys>;
  uploadBlob(blob: Bytes): Promise<{ key: string }>;
  /** `after` is a key or any `e/<13 digits>` prefix; `null` lists from the start. */
  listBlobs(after: string | null, limit?: number): Promise<BlobPage>;
  logout(opts?: RequestOptions): Promise<void>;
}

export interface ApiClientOptions {
  /** Defaults to the global `fetch`. */
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** Prefix for every path; default `''` (same origin). */
  readonly baseUrl?: string;
  /** Default 15 000 ms for every request. */
  readonly timeoutMs?: number;
  /** Default 60 000 ms for a blob upload. */
  readonly uploadTimeoutMs?: number;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const base = options.baseUrl ?? '';
  const defaultTimeout = options.timeoutMs ?? 15_000;
  const uploadTimeout = options.uploadTimeoutMs ?? 60_000;

  async function request(method: 'GET' | 'POST', path: string, body?: unknown, raw?: Bytes, opts: RequestOptions = {}): Promise<unknown> {
    const ctrl = linkedController(opts.signal);
    let timedOut = false;
    const ms = opts.timeoutMs ?? (raw !== undefined ? uploadTimeout : defaultTimeout);
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, ms);
    const stopped = () => (timedOut ? new ApiError('timeout', null, `the server did not answer within ${Math.round(ms / 1000)} s`) : new ApiError('aborted', null, 'request cancelled'));
    try {
      // Raced against the signal too: a fetch implementation that ignores `signal` still can't hang us.
      return await raceAbort(send(method, path, body, raw, ctrl.signal, stopped), ctrl.signal, stopped);
    } finally {
      globalThis.clearTimeout(timer);
      ctrl.abort(); // detach from the caller's signal
    }
  }

  async function send(method: 'GET' | 'POST', path: string, body: unknown, raw: Bytes | undefined, signal: AbortSignal, stopped: () => ApiError): Promise<unknown> {
    const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store', signal };
    if (raw !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/octet-stream' };
      init.body = raw;
    } else if (method === 'POST') {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body ?? {});
    }
    let res: Response;
    try {
      res = await doFetch(base + path, init);
    } catch (e) {
      if (signal.aborted) throw stopped();
      throw new ApiError('network', null, 'could not reach the server', { cause: e });
    }
    if (!res.ok) throw new ApiError(kindFor(res.status), res.status);
    const text = await res.text().catch(() => '');
    if (text === '') return {};
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      throw new ApiError('bad-response', res.status, 'response is not JSON', { cause: e });
    }
  }

  const post = (path: string, body?: unknown, opts?: RequestOptions) => request('POST', path, body, undefined, opts);

  return {
    async status() {
      const r = obj(await request('GET', '/api/status'));
      return { claimed: bool(r.claimed) };
    },
    async registerOptions(auth) {
      return challenge<PublicKeyCredentialCreationOptionsJSON>(await post('/api/register/options', auth ?? {}));
    },
    async registerVerify(body) {
      const r = obj(await post('/api/register/verify', body));
      return { credentialId: str(r.credentialId) };
    },
    async loginOptions(opts) {
      return challenge<PublicKeyCredentialRequestOptionsJSON>(await post('/api/login/options', {}, opts));
    },
    async loginVerify(body, opts) {
      const r = obj(await post('/api/login/verify', body, opts));
      const c = obj(r.credential);
      const keys = epochKeys(r.keys);
      if (keys.delivery === null) throw bad('login without a delivery');
      return {
        vaultId: str(r.vaultId),
        credential: { prfSalt: str(c.prfSalt), publicKey: str(c.publicKey), wrappedPrivateKey: str(c.wrappedPrivateKey), epoch: int(c.epoch), binding: str(c.binding) },
        keys: { ...keys, delivery: keys.delivery },
      };
    },
    async recoveryParams(opts) {
      const r = obj(await request('GET', '/api/recovery/params', undefined, undefined, opts));
      return { vaultId: str(r.vaultId), version: int(r.version), salt: str(r.salt) };
    },
    async recoveryLogin(authToken, opts) {
      const r = obj(await post('/api/recovery/login', { authToken }, opts));
      return { wrappedDk: str(r.wrappedDk), version: int(r.version), history: optStr(r.history) };
    },
    async recoveryRotate(body) {
      const r = obj(await post('/api/recovery/rotate', body));
      return { version: r.version === undefined ? body.version : int(r.version) };
    },
    async stepUpOptions(purpose) {
      return challenge<PublicKeyCredentialRequestOptionsJSON>(await post('/api/stepup/options', { purpose }));
    },
    async credentials() {
      const r = obj(await request('GET', '/api/credentials'));
      if (!Array.isArray(r.credentials)) throw bad('credentials');
      return r.credentials.map((c: unknown) => {
        const o = obj(c);
        return { id: str(o.id), publicKey: str(o.publicKey), epoch: int(o.epoch), binding: str(o.binding) };
      });
    },
    async keys(credentialId) {
      return epochKeys(await request('GET', `/api/keys?${new URLSearchParams({ credential: credentialId }).toString()}`));
    },
    async uploadBlob(blob) {
      const r = obj(await request('POST', '/api/blobs', undefined, blob));
      return { key: str(r.key) };
    },
    async listBlobs(after, limit = MAX_PAGE) {
      const q = new URLSearchParams({ limit: String(Math.min(Math.max(1, limit), MAX_PAGE)) });
      if (after !== null) q.set('after', after);
      const r = obj(await request('GET', `/api/blobs?${q.toString()}`));
      if (!Array.isArray(r.blobs)) throw bad('blobs');
      const blobs = r.blobs.map((b: unknown) => {
        const o = obj(b);
        try {
          return { key: str(o.key), data: fromBase64Url(str(o.data)) };
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw bad('blob data');
        }
      });
      let prev = after;
      for (const b of blobs) {
        if (prev !== null && !(b.key > prev)) throw bad('blobs are not ascending after the cursor');
        prev = b.key;
      }
      return { blobs, more: bool(r.more) };
    },
    async logout(opts) {
      await post('/api/logout', {}, opts);
    },
  };
}

function kindFor(status: number): ApiErrorKind {
  if (status === 400) return 'bad-request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too-large';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server';
  return 'bad-response';
}

const bad = (what: string) => new ApiError('bad-response', null, `unexpected response: ${what}`);

function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad('not an object');
  return v as Record<string, unknown>;
}
function str(v: unknown): string {
  if (typeof v !== 'string') throw bad('expected a string');
  return v;
}
function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw bad('expected a boolean');
  return v;
}
function int(v: unknown): number {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw bad('expected a positive integer');
  return n;
}
function optStr(v: unknown): string | null {
  return v === null || v === undefined ? null : str(v);
}
function delivery(v: unknown): DeliveryJSON {
  const o = obj(v);
  return { epoch: int(o.epoch), ephemeralPublicKey: str(o.ephemeralPublicKey), wrappedDk: str(o.wrappedDk) };
}
function epochKeys(v: unknown): EpochKeys {
  const r = obj(v);
  return { epoch: int(r.epoch), delivery: r.delivery === null || r.delivery === undefined ? null : delivery(r.delivery), history: optStr(r.history) };
}
function challenge<T>(v: unknown): ChallengeOptions<T> {
  const r = obj(v);
  return { options: obj(r.options) as T, challengeToken: str(r.challengeToken) };
}
