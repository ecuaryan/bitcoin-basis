/**
 * The vault: creates, unlocks and locks the encrypted ledger on this device, and owns its
 * `LedgerStore` (`vault.store`). UI screens (Welcome, Setup, Unlock, Kit) use only this API.
 *
 * While locked, nothing secret is in memory. While unlocked, it holds the non-extractable data
 * key, plus the non-extractable KEK it unlocked with and that KEK's wrapping (to wrap new copies
 * for an added passkey or a rotated recovery code). See keys.ts for why no extractable DK is kept.
 */
import { ApiError, createApiClient, type ApiClient } from './api.ts';
import { fromBase64Url, randomBytes, toBase64Url, wipe, type Bytes } from './bytes.ts';
import { EncryptedLedgerStore, type SyncResult, type SyncStatus } from './encrypted-store.ts';
import { defaultChannel, realScheduler, type BroadcastLike, type Scheduler } from './env.ts';
import { VaultError } from './errors.ts';
import { openIndexedDb, type VaultDb } from './idb.ts';
import {
  authVerifier,
  deriveRecoveryAuthToken,
  deriveRecoveryKek,
  derivePasskeyKek,
  importDataKey,
  KeyError,
  newDataKeyBytes,
  SALT_BYTES,
  unwrapDataKey,
  unwrapDataKeyBytes,
  wrapAad,
  wrapDataKey,
} from './keys.ts';
import { browserCredentials, createPasskey, detectPrfSupport, evaluatePrf, getAssertion, PasskeyError, type CredentialsLike, type PrfSupport } from './passkey.ts';
import { RECORD_KEY, parseRecord, type StoredCredential, type StoredRecovery, type VaultRecord } from './record.ts';
import { generateRecoveryCode, parseRecoveryCode } from './recovery-code.ts';

export type VaultState = 'empty' | 'locked' | 'unlocked';
export type LockReason = 'user' | 'idle' | 'hidden';

export interface VaultStatus {
  /** `empty`: no vault on this device (set up or restore). */
  readonly state: VaultState;
  readonly vaultId: string | null;
  /** This device has a passkey with PRF, so it can unlock without the recovery code (also offline). */
  readonly passkeyUnlock: boolean;
  readonly unlockedWith: 'passkey' | 'recovery' | null;
  /** Why the vault last locked itself, for a "Locked after 5 minutes" message. */
  readonly lockReason: LockReason | null;
  readonly autoLockMinutes: number;
  readonly sync: SyncStatus;
}

export interface CreateResult {
  /** Show ONCE (emergency kit), then forget. This is NOT a Bitcoin seed phrase. */
  readonly recoveryCode: string;
  readonly credentialId: string;
}

export interface UnlockResult {
  readonly via: 'passkey' | 'recovery';
  /** Result of the first sync, or `null` when it runs in the background. */
  readonly sync: SyncResult | null;
}

/** Where activity, visibility and connectivity events come from (the browser's by default). */
export interface VaultEnvironment {
  readonly document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
  readonly window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

export interface VaultOptions {
  /** Default: IndexedDB `bitcoin-basis`. */
  readonly db?: VaultDb;
  readonly api?: ApiClient;
  /** Default: `navigator.credentials` (or `null` when WebAuthn is missing). */
  readonly credentials?: CredentialsLike | null;
  readonly prfSupport?: () => Promise<PrfSupport>;
  readonly origin?: string;
  readonly scheduler?: Scheduler;
  /** Default: `navigator.onLine`. */
  readonly isOnline?: () => boolean;
  /** Default 5. 0 turns auto-lock off. */
  readonly autoLockMinutes?: number;
  readonly environment?: VaultEnvironment | null;
  readonly channel?: BroadcastLike | null;
  /** Default 60 s. */
  readonly pollIntervalMs?: number;
}

interface Session {
  readonly vaultId: string;
  readonly dk: CryptoKey;
  /** Non-extractable KEK and its wrapping, to produce raw DK bytes briefly when wrapping a new copy. */
  readonly rewrap: { readonly kek: CryptoKey; readonly wrapped: Bytes; readonly aad: Bytes };
  readonly via: 'passkey' | 'recovery';
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
const b64 = toBase64Url;

export class Vault {
  /** The encrypted ledger. Empty while locked. */
  readonly store: EncryptedLedgerStore;

  private record: VaultRecord | null;
  private session: Session | null = null;
  private readonly listeners = new Set<(s: VaultStatus) => void>();
  private lockReason: LockReason | null = null;
  private autoLockMinutes: number;
  private lastActivity = 0;
  private hiddenAt: number | null = null;
  private idleTimer: unknown = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly api: ApiClient;
  private readonly credentials: CredentialsLike | null;
  private readonly scheduler: Scheduler;
  private readonly isOnline: () => boolean;
  private readonly origin: string;
  private readonly prfSupport: () => Promise<PrfSupport>;
  private readonly env: VaultEnvironment | null;
  private cachedStatus: VaultStatus | null = null;

  /** Open the vault stored on this device (or an empty one). */
  static async open(options: VaultOptions = {}): Promise<Vault> {
    const db = options.db ?? (await openIndexedDb());
    const record = parseRecord(await db.get('vault', RECORD_KEY));
    return new Vault(db, record, options);
  }

  private constructor(
    private readonly db: VaultDb,
    record: VaultRecord | null,
    options: VaultOptions,
  ) {
    this.record = record;
    this.api = options.api ?? createApiClient();
    this.credentials = options.credentials === undefined ? browserCredentials() : options.credentials;
    this.scheduler = options.scheduler ?? realScheduler;
    this.isOnline = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.origin = options.origin ?? (typeof location === 'undefined' ? '' : location.origin);
    this.prfSupport = options.prfSupport ?? (() => detectPrfSupport());
    this.autoLockMinutes = options.autoLockMinutes ?? 5;
    this.env =
      options.environment === undefined
        ? { document: typeof document === 'undefined' ? null : document, window: typeof window === 'undefined' ? null : window }
        : options.environment;
    this.store = new EncryptedLedgerStore({
      db,
      api: this.api,
      scheduler: this.scheduler,
      isOnline: this.isOnline,
      pollIntervalMs: options.pollIntervalMs ?? 60_000,
      channel: options.channel === undefined ? defaultChannel() : options.channel,
      onStatus: () => this.emit(),
    });
    for (const t of ACTIVITY_EVENTS) this.env?.document?.addEventListener(t, this.onActivity, { passive: true });
    this.env?.document?.addEventListener('visibilitychange', this.onVisibility);
    this.env?.window?.addEventListener('online', this.onOnline);
  }

  // --- Status ------------------------------------------------------------------------------------

  get status(): VaultStatus {
    this.cachedStatus ??= {
      state: this.session !== null ? 'unlocked' : this.record !== null ? 'locked' : 'empty',
      vaultId: this.record?.vaultId ?? null,
      passkeyUnlock: (this.record?.credentials.length ?? 0) > 0,
      unlockedWith: this.session?.via ?? null,
      lockReason: this.lockReason,
      autoLockMinutes: this.autoLockMinutes,
      sync: this.store.status,
    };
    return this.cachedStatus;
  }

  /** Called with the new status after every change. Returns an unsubscribe function. */
  subscribe(listener: (status: VaultStatus) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** True while the data key (or the KEK that can recover it) is in memory. For tests and diagnostics. */
  holdsKeyMaterial(): boolean {
    return this.session !== null || this.store.unlocked;
  }

  /** Whether the server already has a vault (Welcome: "Set up" vs "Restore"). */
  async serverStatus(): Promise<{ claimed: boolean }> {
    return this.api.status().catch((e: unknown) => {
      throw mapApi(e);
    });
  }

  // --- Create ------------------------------------------------------------------------------------

  /**
   * Set up a new vault: new DK and recovery code, register the first passkey with the setup code
   * and claim the server. Returns the recovery code ONCE; the vault is unlocked afterwards.
   * Needs a passkey with PRF (`prf-unavailable` otherwise, before the server is claimed).
   */
  create({ setupCode }: { setupCode: string }): Promise<CreateResult> {
    return this.exclusive(async () => {
      if (this.record !== null) throw new VaultError('vault-exists');
      const creds = this.requireCredentials();
      // The server needs a PRF-wrapped DK with the first passkey, so setup needs PRF.
      if ((await this.prfSupport()) === 'unsupported') throw new VaultError('prf-unavailable');
      const vaultId = b64(randomBytes(16));
      const rawDk = newDataKeyBytes();
      const prfSalt = randomBytes(SALT_BYTES);
      let token: Bytes | null = null;
      try {
        const code = await generateRecoveryCode();
        const salt = randomBytes(SALT_BYTES);
        const recKek = await deriveRecoveryKek(code.secret, salt);
        token = await deriveRecoveryAuthToken(code.secret, salt);
        wipe(code.secret);
        const recAad = wrapAad(vaultId, { type: 'recovery', version: 1 });
        const recWrapped = await wrapDataKey(rawDk, recKek, recAad);

        const opts = await this.api.registerOptions({ setupCode }).catch(async (e: unknown) => {
          if (e instanceof ApiError && (e.kind === 'forbidden' || e.kind === 'unauthorized')) {
            const claimed = await this.api.status().then((s) => s.claimed, () => false);
            throw new VaultError(claimed ? 'already-claimed' : 'wrong-setup-code', undefined, { cause: e });
          }
          throw mapApi(e);
        });
        const pk = await createPasskey(creds, opts.options).catch((e: unknown) => {
          throw mapPasskey(e);
        });
        // Created on the authenticator, but it can't unlock: don't claim the server with it.
        if (pk.prfOutput === null) throw new VaultError('prf-unavailable');
        const kek = await derivePasskeyKek(pk.prfOutput, prfSalt);
        wipe(pk.prfOutput);
        const pkWrapped = await wrapDataKey(rawDk, kek, wrapAad(vaultId, { type: 'passkey', credentialId: pk.credentialId }));
        // Sets the session cookie.
        await this.api
          .registerVerify({
            response: pk.response,
            challengeToken: opts.challengeToken,
            prfSalt: b64(prfSalt),
            wrappedDk: b64(pkWrapped),
            claim: { vaultId, recovery: { salt: b64(salt), authVerifier: b64(await authVerifier(token)), wrappedDk: b64(recWrapped) } },
          })
          .catch((e: unknown) => {
            throw e instanceof ApiError && e.kind === 'conflict' ? new VaultError('already-claimed', undefined, { cause: e }) : mapApi(e);
          });

        // The server is claimed: save the record before anything else can fail.
        const credentials: StoredCredential[] = [{ id: pk.credentialId, prfSalt: b64(prfSalt), wrappedDk: b64(pkWrapped) }];
        await this.putRecord({ vaultId, recovery: { version: 1, salt: b64(salt), wrappedDk: b64(recWrapped) }, credentials, cursor: null, origin: this.origin });
        const dk = await importDataKey(rawDk);
        await this.begin({ vaultId, dk, rewrap: { kek, wrapped: pkWrapped, aad: wrapAad(vaultId, { type: 'passkey', credentialId: pk.credentialId }) }, via: 'passkey' });
        void this.store.sync();
        return { recoveryCode: code.text, credentialId: pk.credentialId };
      } finally {
        wipe(rawDk);
        wipe(token);
      }
    });
  }

  // --- Unlock ------------------------------------------------------------------------------------

  /**
   * Unlock with a passkey. Online: one prompt gives both a server session and the PRF output,
   * also on a fresh device with a synced passkey (the PRF input is a constant). Offline: a local
   * challenge, PRF only, no session.
   */
  unlockWithPasskey(): Promise<UnlockResult> {
    return this.exclusive(async () => {
      if (this.session !== null) return { via: this.session.via, sync: null };
      const creds = this.requireCredentials();
      const known = this.knownCredentials();
      const online = this.isOnline() ? await this.api.loginOptions().catch((e: unknown) => (e instanceof ApiError && e.kind === 'network' ? null : Promise.reject(mapApi(e)))) : null;

      if (online === null) {
        if (this.record === null) throw new VaultError('offline');
        if (known.length === 0) throw new VaultError('no-passkey');
        const { credentialId, prfOutput } = await evaluatePrf(creds, known).catch((e: unknown) => {
          throw mapPasskey(e);
        });
        const stored = this.record.credentials.find((c) => c.id === credentialId) as StoredCredential;
        await this.beginWithPasskey(this.record.vaultId, stored, prfOutput, null);
        return { via: 'passkey', sync: null };
      }

      const assertion = await getAssertion(creds, online.options, known).catch((e: unknown) => {
        throw mapPasskey(e);
      });
      const login = await this.api.loginVerify({ response: assertion.response, challengeToken: online.challengeToken }).catch((e: unknown) => {
        throw e instanceof ApiError && (e.kind === 'unauthorized' || e.kind === 'not-found') ? new VaultError('passkey-rejected', undefined, { cause: e }) : mapApi(e);
      });
      if (this.record !== null && login.vaultId !== this.record.vaultId) throw new VaultError('vault-mismatch');
      const local = this.record?.credentials.find((c) => c.id === assertion.credentialId);
      const prfSalt = local?.prfSalt ?? login.prfSalt;
      const wrappedDk = local?.wrappedDk ?? login.wrappedDk;
      const stored: StoredCredential = { id: assertion.credentialId, prfSalt, wrappedDk };
      let prfOutput = assertion.prfOutput;
      if (prfOutput === null) {
        prfOutput = (
          await evaluatePrf(creds, [stored.id], online.options.rpId).catch((e: unknown) => {
            throw mapPasskey(e);
          })
        ).prfOutput;
      }
      const fresh = this.record === null;
      await this.beginWithPasskey(login.vaultId, stored, prfOutput, fresh ? { vaultId: login.vaultId, recovery: null, credentials: [], cursor: null, origin: this.origin } : null);
      if (fresh) return { via: 'passkey', sync: await this.store.sync() };
      void this.store.sync();
      return { via: 'passkey', sync: null };
    });
  }

  /**
   * Unlock with the recovery code. On a device that already holds the vault this works offline.
   * On a fresh device it restores: params → auth token → session → wrapped DK → full sync.
   * Typos are reported (as `RecoveryCodeError`) before any network call.
   */
  unlockWithRecoveryCode(input: string): Promise<UnlockResult> {
    return this.exclusive(async () => {
      if (this.session !== null) return { via: this.session.via, sync: null };
      const code = await parseRecoveryCode(input);
      try {
        const local = this.record?.recovery ?? null;
        if (this.record !== null && local !== null) {
          const salt = fromBase64Url(local.salt);
          const kek = await deriveRecoveryKek(code.secret, salt);
          const aad = wrapAad(this.record.vaultId, { type: 'recovery', version: local.version });
          const wrapped = fromBase64Url(local.wrappedDk);
          const dk = await unwrapDataKey(wrapped, kek, aad).catch(() => null);
          if (dk !== null) {
            if (this.isOnline()) {
              const token = await deriveRecoveryAuthToken(code.secret, salt);
              await this.api.recoveryLogin(b64(token)).catch(() => undefined);
              wipe(token);
            }
            await this.begin({ vaultId: this.record.vaultId, dk, rewrap: { kek, wrapped, aad }, via: 'recovery' });
            void this.store.sync();
            return { via: 'recovery', sync: null };
          }
        }

        if (!this.isOnline()) throw new VaultError(this.record === null ? 'offline' : 'wrong-recovery-code');
        const params = await this.api.recoveryParams().catch((e: unknown) => {
          throw e instanceof ApiError && e.kind === 'not-found' ? new VaultError('no-vault', 'the server has no vault yet', { cause: e }) : mapApi(e);
        });
        if (this.record !== null && params.vaultId !== this.record.vaultId) throw new VaultError('vault-mismatch');
        const salt = fromBase64Url(params.salt);
        const token = await deriveRecoveryAuthToken(code.secret, salt);
        const login = await this.api.recoveryLogin(b64(token)).catch((e: unknown) => {
          throw e instanceof ApiError && e.kind === 'unauthorized' ? new VaultError('wrong-recovery-code', undefined, { cause: e }) : mapApi(e);
        });
        wipe(token);
        const kek = await deriveRecoveryKek(code.secret, salt);
        const aad = wrapAad(params.vaultId, { type: 'recovery', version: login.version });
        const wrapped = fromBase64Url(login.wrappedDk);
        const dk = await unwrapDataKey(wrapped, kek, aad).catch((e: unknown) => {
          throw new VaultError('wrong-recovery-code', undefined, { cause: e });
        });
        const recovery: StoredRecovery = { version: login.version, salt: params.salt, wrappedDk: login.wrappedDk };
        if (this.record === null) await this.putRecord({ vaultId: params.vaultId, recovery, credentials: [], cursor: null, origin: this.origin });
        else await this.updateRecord((r) => ({ ...r, recovery }));
        await this.begin({ vaultId: params.vaultId, dk, rewrap: { kek, wrapped, aad }, via: 'recovery' });
        return { via: 'recovery', sync: await this.store.sync() };
      } finally {
        wipe(code.secret);
      }
    });
  }

  /** Get a server session while already unlocked (after an offline unlock or an expired session). One passkey prompt. */
  connect(): Promise<SyncResult> {
    return this.exclusive(async () => {
      this.requireSession();
      const creds = this.requireCredentials();
      const known = this.knownCredentials();
      if (known.length === 0) throw new VaultError('no-passkey');
      const opts = await this.api.loginOptions().catch((e: unknown) => {
        throw mapApi(e);
      });
      const a = await getAssertion(creds, opts.options, known).catch((e: unknown) => {
        throw mapPasskey(e);
      });
      wipe(a.prfOutput);
      const login = await this.api.loginVerify({ response: a.response, challengeToken: opts.challengeToken }).catch((e: unknown) => {
        throw e instanceof ApiError && e.kind === 'unauthorized' ? new VaultError('passkey-rejected', undefined, { cause: e }) : mapApi(e);
      });
      if (login.vaultId !== this.record?.vaultId) throw new VaultError('vault-mismatch');
      return this.store.sync();
    });
  }

  // --- Changes while unlocked --------------------------------------------------------------------

  /** Register another passkey (this device or a phone/key nearby) for this vault. Needs a session. */
  addPasskey(): Promise<{ credentialId: string }> {
    return this.exclusive(async () => {
      const session = this.requireSession();
      const creds = this.requireCredentials();
      if ((await this.prfSupport()) === 'unsupported') throw new VaultError('prf-unavailable');
      const opts = await this.api.registerOptions(null).catch((e: unknown) => {
        throw mapApi(e);
      });
      const prfSalt = randomBytes(SALT_BYTES);
      const pk = await createPasskey(creds, opts.options).catch((e: unknown) => {
        throw mapPasskey(e);
      });
      // Created on the authenticator but useless for unlocking: don't register it.
      if (pk.prfOutput === null) throw new VaultError('prf-unavailable');
      const kek = await derivePasskeyKek(pk.prfOutput, prfSalt);
      wipe(pk.prfOutput);
      const wrapped = await this.wrapCopy(session, kek, wrapAad(session.vaultId, { type: 'passkey', credentialId: pk.credentialId }));
      await this.api.registerVerify({ response: pk.response, challengeToken: opts.challengeToken, prfSalt: b64(prfSalt), wrappedDk: b64(wrapped) }).catch((e: unknown) => {
        throw mapApi(e);
      });
      const cred: StoredCredential = { id: pk.credentialId, prfSalt: b64(prfSalt), wrappedDk: b64(wrapped) };
      await this.updateRecord((r) => ({ ...r, credentials: [...r.credentials.filter((c) => c.id !== cred.id), cred] }));
      return { credentialId: pk.credentialId };
    });
  }

  /** Replace the recovery code (after printing a new kit). The old code stops working. Returns the new code ONCE. */
  rotateRecoveryCode(): Promise<{ recoveryCode: string }> {
    return this.exclusive(async () => {
      const session = this.requireSession();
      const params = await this.api.recoveryParams().catch((e: unknown) => {
        throw mapApi(e);
      });
      if (params.vaultId !== session.vaultId) throw new VaultError('vault-mismatch');
      const version = params.version + 1;
      const code = await generateRecoveryCode();
      const salt = randomBytes(SALT_BYTES);
      const kek = await deriveRecoveryKek(code.secret, salt);
      const token = await deriveRecoveryAuthToken(code.secret, salt);
      wipe(code.secret);
      const wrapped = await this.wrapCopy(session, kek, wrapAad(session.vaultId, { type: 'recovery', version }));
      const res = await this.api.recoveryRotate({ version, salt: b64(salt), authVerifier: b64(await authVerifier(token)), wrappedDk: b64(wrapped) }).catch((e: unknown) => {
        throw mapApi(e);
      });
      wipe(token);
      if (res.version !== version) throw new VaultError('server', `server stored recovery version ${res.version}, expected ${version}`);
      await this.updateRecord((r) => ({ ...r, recovery: { version, salt: b64(salt), wrappedDk: b64(wrapped) } }));
      return { recoveryCode: code.text };
    });
  }

  /** Pull and push now (e.g. on a "Sync" button). */
  sync(): Promise<SyncResult> {
    return this.store.sync();
  }

  // --- Lock --------------------------------------------------------------------------------------

  /** Drop the data key and every plaintext entry. Also ends the server session (best effort). */
  lock(reason: LockReason = 'user'): void {
    if (this.session === null) return;
    this.session = null;
    this.store.stop();
    this.clearIdle();
    this.hiddenAt = null;
    this.lockReason = reason;
    if (this.isOnline()) void this.api.logout().catch(() => undefined);
    this.emit();
  }

  /** Record user activity (resets the idle timer). Called automatically for pointer and key events. */
  touch(): void {
    this.lastActivity = this.scheduler.now();
  }

  /** Change the auto-lock delay; 0 turns it off. */
  setAutoLockMinutes(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('auto-lock minutes must be 0 or more');
    this.autoLockMinutes = minutes;
    this.touch();
    this.scheduleIdle();
    this.emit();
  }

  /** Lock and delete everything this device stores (the server copy is untouched). */
  async forgetDevice(): Promise<void> {
    this.lock();
    await this.db.clear();
    this.record = null;
    this.lockReason = null;
    this.emit();
  }

  /** Remove event listeners and timers (tests, hot reload). */
  dispose(): void {
    this.lock();
    this.store.dispose();
    for (const t of ACTIVITY_EVENTS) this.env?.document?.removeEventListener(t, this.onActivity);
    this.env?.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.env?.window?.removeEventListener('online', this.onOnline);
  }

  // --- Internals ---------------------------------------------------------------------------------

  /** Unwrap with a passkey's PRF output and start. `freshRecord` is saved (with the credential) only once unwrapping worked. */
  private async beginWithPasskey(vaultId: string, cred: StoredCredential, prfOutput: Bytes, freshRecord: VaultRecord | null): Promise<void> {
    const kek = await derivePasskeyKek(prfOutput, fromBase64Url(cred.prfSalt));
    wipe(prfOutput);
    const aad = wrapAad(vaultId, { type: 'passkey', credentialId: cred.id });
    const wrapped = fromBase64Url(cred.wrappedDk);
    const dk = await unwrapDataKey(wrapped, kek, aad).catch((e: unknown) => {
      throw e instanceof KeyError ? new VaultError('passkey-rejected', 'this passkey does not open this vault', { cause: e }) : e;
    });
    if (freshRecord !== null) await this.putRecord({ ...freshRecord, credentials: [cred] });
    else await this.updateRecord((r) => ({ ...r, credentials: [...r.credentials.filter((c) => c.id !== cred.id), cred] }));
    await this.begin({ vaultId, dk, rewrap: { kek, wrapped, aad }, via: 'passkey' });
  }

  private async begin(session: Session): Promise<void> {
    this.session = session;
    this.lockReason = null;
    this.hiddenAt = null;
    this.touch();
    this.scheduleIdle();
    this.emit();
    await this.store.start({ vaultId: session.vaultId, dk: session.dk });
  }

  /** Wrap a new DK copy under `kek`; the raw DK exists only inside this call. */
  private async wrapCopy(session: Session, kek: CryptoKey, aad: Bytes): Promise<Bytes> {
    const raw = await unwrapDataKeyBytes(session.rewrap.wrapped, session.rewrap.kek, session.rewrap.aad);
    try {
      return await wrapDataKey(raw, kek, aad);
    } finally {
      wipe(raw);
    }
  }

  private knownCredentials(): string[] {
    return (this.record?.credentials ?? []).map((c) => c.id);
  }

  private async putRecord(record: VaultRecord): Promise<void> {
    await this.db.write([{ type: 'put', store: 'vault', key: RECORD_KEY, value: record }]);
    this.record = record;
    this.emit();
  }

  /** Read-modify-write in one transaction, so the store's cursor updates are never lost. */
  private async updateRecord(fn: (r: VaultRecord) => VaultRecord): Promise<void> {
    await this.db.write([
      {
        type: 'update',
        store: 'vault',
        key: RECORD_KEY,
        fn: (old) => {
          const r = parseRecord(old) ?? this.record;
          return r === null ? old : fn(r);
        },
      },
    ]);
    this.record = parseRecord(await this.db.get('vault', RECORD_KEY));
    this.emit();
  }

  private requireSession(): Session {
    if (this.session === null) throw new VaultError('locked');
    return this.session;
  }

  private requireCredentials(): CredentialsLike {
    if (this.credentials === null) throw new VaultError('passkeys-unsupported');
    return this.credentials;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(): void {
    this.cachedStatus = null;
    const s = this.status;
    for (const l of [...this.listeners]) l(s);
  }

  // Idle and visibility auto-lock.

  private scheduleIdle(): void {
    this.clearIdle();
    if (this.session === null || this.autoLockMinutes <= 0) return;
    const limit = this.autoLockMinutes * 60_000;
    const wait = Math.max(0, this.lastActivity + limit - this.scheduler.now());
    this.idleTimer = this.scheduler.setTimeout(() => {
      this.idleTimer = null;
      if (this.session === null) return;
      if (this.scheduler.now() - this.lastActivity >= limit) this.lock('idle');
      else this.scheduleIdle();
    }, wait);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) this.scheduler.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private readonly onActivity = () => this.touch();

  private readonly onVisibility = () => {
    const hidden = this.env?.document?.visibilityState === 'hidden';
    if (hidden) {
      this.hiddenAt = this.scheduler.now();
      return;
    }
    const since = this.hiddenAt;
    this.hiddenAt = null;
    if (since === null || this.session === null) return;
    if (this.autoLockMinutes > 0 && this.scheduler.now() - since >= this.autoLockMinutes * 60_000) this.lock('hidden');
    else this.scheduleIdle();
  };

  private readonly onOnline = () => {
    if (this.session !== null) void this.store.sync();
  };
}

function mapApi(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  if (e.kind === 'network') return new VaultError('offline', undefined, { cause: e });
  if (e.kind === 'unauthorized') return new VaultError('needs-session', undefined, { cause: e });
  return e;
}

function mapPasskey(e: unknown): unknown {
  if (!(e instanceof PasskeyError)) return e;
  if (e.code === 'prf-unavailable') return new VaultError('prf-unavailable', undefined, { cause: e });
  if (e.code === 'unsupported') return new VaultError('passkeys-unsupported', undefined, { cause: e });
  if (e.code === 'no-credential') return new VaultError('no-passkey', undefined, { cause: e });
  return e;
}
