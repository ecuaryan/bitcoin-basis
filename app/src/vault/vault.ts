/**
 * The vault: creates, unlocks and locks the encrypted ledger on this device, and owns its
 * `LedgerStore` (`vault.store`). UI screens (Welcome, Setup, Unlock, Kit) use only this API.
 *
 * Keys come in epochs (see keys.ts and docs/sync-protocol.md): every recovery-code rotation starts
 * a new data key, delivers it to every registered passkey, and seals the older keys under it. The
 * old code therefore opens nothing written after the rotation.
 *
 * While locked, nothing secret is in memory. While unlocked, it holds the non-extractable data keys,
 * the passkey's non-extractable ECDH private key (to receive the next epoch's key), and the
 * non-extractable KEK plus wrapping of the current DK (to wrap new copies for an added passkey or a
 * rotation). Raw key bytes and PRF outputs are wiped as soon as they are used, on every path.
 *
 * Unlocking can never hang: every passkey prompt and network call takes the attempt's
 * `AbortSignal` and has a timeout, a new attempt aborts the one before it (which releases the
 * serial queue at once), and a device that holds the vault opens its local copy when the server
 * is slow or unreachable (passkey PRF only), syncing later.
 */
import { isAborted, linkedController, raceAbort, settleWithin } from './abort.ts';
import { ApiError, createApiClient, isUnreachable, type ApiClient, type ChallengeOptions, type DeliveryJSON, type LoginResult, type RequestOptions, type StepUp } from './api.ts';
import { concatBytes, fromBase64Url, randomBytes, toBase64Url, wipe, type Bytes } from './bytes.ts';
import { EncryptedLedgerStore, type SyncResult, type SyncStatus } from './encrypted-store.ts';
import { defaultChannel, realScheduler, type BroadcastLike, type Scheduler } from './env.ts';
import { VaultError } from './errors.ts';
import { openIndexedDb, type VaultDb } from './idb.ts';
import {
  authVerifier,
  bindCredential,
  credentialKeyAad,
  deliverDataKey,
  deriveRecoveryAuthToken,
  deriveRecoveryKek,
  derivePasskeyKek,
  generateCredentialKey,
  importDataKey,
  KeyError,
  newDataKeyBytes,
  openDelivery,
  openHistory,
  openHistoryBytes,
  SALT_BYTES,
  sealHistory,
  unwrapCredentialKey,
  unwrapDataKey,
  unwrapDataKeyBytes,
  verifyCredentialBinding,
  wrapAad,
  wrapCredentialKey,
  wrapDataKey,
} from './keys.ts';
import { browserCredentials, createPasskey, detectPrfSupport, evaluatePrf, getAssertion, PasskeyError, type CredentialsLike, type PrfSupport, type PublicKeyCredentialRequestOptionsJSON } from './passkey.ts';
import { RECORD_FORMAT, RECORD_KEY, parseRecord, type StoredCredential, type StoredDelivery, type StoredRecovery, type VaultRecord } from './record.ts';
import { generateRecoveryCode, parseRecoveryCode } from './recovery-code.ts';

export type VaultState = 'empty' | 'locked' | 'unlocked';
export type LockReason = 'user' | 'idle' | 'hidden';

/** What an unlock is doing right now, for the Unlock screen. */
export type UnlockStep =
  /** Asking the server for a sign-in challenge. */
  | 'connecting'
  /** Waiting for the passkey prompt (fingerprint, face, screen lock). */
  | 'passkey'
  /** Checking the sign-in (or the recovery code) with the server. */
  | 'signing-in'
  /** Decrypting the local copy. */
  | 'opening';

export interface UnlockOptions {
  /** Abort this attempt (also aborted by any newer unlock attempt, or `cancelUnlock()`). */
  readonly signal?: AbortSignal;
  readonly onStep?: (step: UnlockStep) => void;
}

/** How long an unlock waits for the server before the prompt (then it opens the local copy offline). */
export const UNLOCK_NETWORK_MS = 8_000;
/** After the server timed out, unlocks skip it for this long and go straight to the prompt. */
export const SLOW_SERVER_MS = 60_000;

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
  /**
   * The recovery code was replaced on another device, so this device dropped its copy of the old
   * one ("Your recovery code changed"): the old kit no longer works anywhere. Cleared by unlocking
   * with the new code here, rotating here, or `dismissRecoveryNotice()`.
   */
  readonly recoveryCodeChanged: boolean;
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
  /** How long an unlock waits for the server before the prompt. Default `UNLOCK_NETWORK_MS`. */
  readonly unlockNetworkMs?: number;
}

/** A non-extractable KEK and the wrapping it opens: produces the current DK's raw bytes briefly, to wrap new copies. */
interface Rewrap {
  readonly kek: CryptoKey;
  readonly wrapped: Bytes;
  readonly aad: Bytes;
}

interface Session {
  readonly vaultId: string;
  readonly via: 'passkey' | 'recovery';
  /** The epoch new blobs are sealed under. */
  epoch: number;
  /** Every data key held, by epoch. */
  readonly keys: Map<number, CryptoKey>;
  current: Rewrap;
  /** The current epoch's history ciphertext (older keys under DK_epoch), `null` for epoch 1. */
  history: Bytes | null;
  /** The passkey this session unlocked (or later signed in) with, and its ECDH private key (to receive newer epochs). */
  credential: { readonly id: string; readonly privateKey: CryptoKey; readonly publicKey: Bytes } | null;
  /** Unlocked with the recovery code: its auth token, the step-up proof for adding a passkey. Wiped on lock. */
  recoveryToken: Bytes | null;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
const b64 = toBase64Url;
const unb64 = fromBase64Url;

export class Vault {
  /** The encrypted ledger. Empty while locked. */
  readonly store: EncryptedLedgerStore;

  private record: VaultRecord | null;
  private session: Session | null = null;
  /** What kind of server session the cookie holds, as far as this tab knows. */
  private serverSession: 'passkey' | 'recovery' | null = null;
  /** Bumped by every lock: an unlock that started before a lock must not finish unlocking. */
  private lockGen = 0;
  private logoutInFlight: Promise<void> | null = null;
  private logoutPending = false;
  /** Bumped by every sign-in: a logout that fails after a newer sign-in must not be queued (it would end the new session). */
  private signIns = 0;
  /** The unlock attempt in progress (aborted by the next one). */
  private unlockCtrl: AbortController | null = null;
  /** Until when unlocks skip the server (it just timed out). */
  private serverSlowUntil = 0;
  private refreshing: Promise<void> | null = null;
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
  private readonly unlockNetworkMs: number;
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
    this.logoutPending = record?.logoutPending ?? false;
    this.api = options.api ?? createApiClient();
    this.credentials = options.credentials === undefined ? browserCredentials() : options.credentials;
    this.scheduler = options.scheduler ?? realScheduler;
    this.isOnline = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.origin = options.origin ?? (typeof location === 'undefined' ? '' : location.origin);
    this.prfSupport = options.prfSupport ?? (() => detectPrfSupport());
    this.autoLockMinutes = options.autoLockMinutes ?? 5;
    this.unlockNetworkMs = options.unlockNetworkMs ?? UNLOCK_NETWORK_MS;
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
      beforeSync: () => this.refresh(),
      beforeSeal: () => this.ensureNewestKey(),
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
      recoveryCodeChanged: this.record?.recoveryChanged ?? false,
      sync: this.store.status,
    };
    return this.cachedStatus;
  }

  /** Called with the new status after every change. Returns an unsubscribe function. */
  subscribe(listener: (status: VaultStatus) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** True while a data key (or the KEK that can recover it) is in memory. For tests and diagnostics. */
  holdsKeyMaterial(): boolean {
    return this.session !== null || this.store.unlocked;
  }

  /** An unlock attempt is running (e.g. a passkey prompt is open). */
  get unlocking(): boolean {
    return this.unlockCtrl !== null;
  }

  /** Abandon the unlock attempt in progress, if any (its promise rejects with `aborted`). */
  cancelUnlock(): void {
    this.unlockCtrl?.abort();
    this.unlockCtrl = null;
  }

  /** Whether the server already has a vault (Welcome: "Set up" vs "Restore"). */
  async serverStatus(): Promise<{ claimed: boolean }> {
    return this.api.status().catch((e: unknown) => {
      throw mapApi(e);
    });
  }

  /** Hide the "recovery code changed" notice. */
  async dismissRecoveryNotice(): Promise<void> {
    if (this.record?.recoveryChanged) await this.updateRecord((r) => ({ ...r, recoveryChanged: false }));
  }

  // --- Create ------------------------------------------------------------------------------------

  /**
   * Set up a new vault: new DK (epoch 1) and recovery code, register the first passkey with the
   * setup code and claim the server. Returns the recovery code ONCE; the vault is unlocked afterwards.
   * Needs a passkey with PRF (`prf-unavailable` otherwise, before the server is claimed).
   */
  create({ setupCode }: { setupCode: string }): Promise<CreateResult> {
    // Taken now, not when the queued work starts: a lock() issued after this call must win.
    const gen = this.lockGen;
    return this.exclusive(async () => {
      if (this.record !== null) throw new VaultError('vault-exists');
      const creds = this.requireCredentials();
      // The server needs a PRF-wrapped key with the first passkey, so setup needs PRF.
      if ((await this.prfSupport()) === 'unsupported') throw new VaultError('prf-unavailable');
      const vaultId = b64(randomBytes(16));
      const rawDk = newDataKeyBytes();
      const prfSalt = randomBytes(SALT_BYTES);
      let token: Bytes | null = null;
      let secret: Bytes | null = null;
      let prfOutput: Bytes | null = null;
      try {
        const code = await generateRecoveryCode();
        secret = code.secret;
        const salt = randomBytes(SALT_BYTES);
        const recKek = await deriveRecoveryKek(secret, salt);
        token = await deriveRecoveryAuthToken(secret, salt);
        wipe(secret);
        const recAad = wrapAad(vaultId, { type: 'recovery', version: 1 });
        const recWrapped = await wrapDataKey(rawDk, recKek, recAad);
        const dk = await importDataKey(rawDk);

        await this.flushLogout();
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
        prfOutput = pk.prfOutput;
        // Created on the authenticator, but it can't unlock: don't claim the server with it.
        if (prfOutput === null) throw new VaultError('prf-unavailable');
        const kek = await derivePasskeyKek(prfOutput, prfSalt);
        wipe(prfOutput);
        const made = await makeCredentialKeys(vaultId, pk.credentialId, kek, rawDk, dk, 1, prfSalt);
        // Sets the session cookie.
        await this.api
          .registerVerify({
            response: pk.response,
            challengeToken: opts.challengeToken,
            prfSalt: b64(prfSalt),
            credentialKey: made.credentialKey,
            delivery: made.delivery,
            claim: { vaultId, recovery: { salt: b64(salt), authVerifier: b64(await authVerifier(token)), wrappedDk: b64(recWrapped) } },
          })
          .catch((e: unknown) => {
            throw e instanceof ApiError && e.kind === 'conflict' ? new VaultError('already-claimed', undefined, { cause: e }) : mapApi(e);
          });
        this.sessionStarted('passkey');

        // The server is claimed: save the record before anything else can fail.
        await this.putRecord({
          ...emptyRecord(vaultId, this.origin, this.scheduler.now()),
          recovery: { version: 1, salt: b64(salt), wrappedDk: b64(recWrapped) },
          credentials: [made.stored],
        });
        // A lock while setting up leaves the new vault locked (the code is still returned, once).
        if (gen === this.lockGen) {
          await this.begin({
            vaultId,
            via: 'passkey',
            epoch: 1,
            keys: new Map([[1, dk]]),
            current: { kek: recKek, wrapped: recWrapped, aad: recAad },
            history: null,
            credential: { id: pk.credentialId, privateKey: made.privateKey, publicKey: made.publicKey },
            recoveryToken: null,
          });
          void this.store.sync();
        }
        return { recoveryCode: code.text, credentialId: pk.credentialId };
      } finally {
        wipe(rawDk);
        wipe(token);
        wipe(secret);
        wipe(prfOutput);
      }
    });
  }

  // --- Unlock ------------------------------------------------------------------------------------

  /**
   * Unlock with a passkey. Online: one prompt gives both a server session and the PRF output,
   * also on a fresh device with a synced passkey (the PRF input is a constant). Offline, or when
   * the server is slow or down: a local challenge, PRF only, no session (sync signs in later).
   * Starting this aborts any unlock attempt still in progress.
   */
  unlockWithPasskey(opts: UnlockOptions = {}): Promise<UnlockResult> {
    // Taken now, not when the queued work starts: a lock() issued after this call must win.
    const gen = this.lockGen;
    const ctrl = this.newUnlockAttempt(opts.signal);
    const signal = ctrl.signal;
    const step = (s: UnlockStep) => {
      if (!signal.aborted) opts.onStep?.(s);
    };
    return this.attempt(ctrl, async () => {
      if (this.session !== null) return { via: this.session.via, sync: null };
      const creds = this.requireCredentials();
      const known = this.knownCredentials();
      const prompt = { signal };
      let online: ChallengeOptions<PublicKeyCredentialRequestOptionsJSON> | null = null;
      let unreachable: VaultError | null = this.isOnline() ? null : new VaultError('offline');
      if (unreachable === null && this.serverSlow()) unreachable = new VaultError('timeout', 'the server was too slow a moment ago');
      if (unreachable === null) {
        step('connecting');
        const net = { signal, timeoutMs: this.unlockNetworkMs };
        if (!(await this.flushLogout(net))) unreachable = new VaultError('timeout');
        else {
          online = await this.api.loginOptions(net).catch((e: unknown) => {
            if (fallsBack(e) && this.knownCredentials().length > 0) {
              unreachable = this.unreachable(e);
              return null;
            }
            throw mapApi(e);
          });
        }
      }

      if (online === null) {
        if (this.record === null) throw unreachable ?? new VaultError('offline');
        if (known.length === 0) throw new VaultError('no-passkey');
        step('passkey');
        const { credentialId, prfOutput } = await evaluatePrf(creds, known, undefined, prompt).catch(rethrowPasskey);
        step('opening');
        return this.openLocally(credentialId, prfOutput, gen, signal);
      }

      step('passkey');
      const assertion = await getAssertion(creds, online.options, known, prompt).catch(rethrowPasskey);
      let prfOutput = assertion.prfOutput;
      try {
        step('signing-in');
        let login: LoginResult;
        try {
          login = await this.api.loginVerify({ response: assertion.response, challengeToken: online.challengeToken }, { signal });
        } catch (e) {
          if (e instanceof ApiError && (e.kind === 'unauthorized' || e.kind === 'not-found')) throw new VaultError('passkey-rejected', undefined, { cause: e });
          // The server went quiet after the prompt: this device holds the vault, and this same prompt
          // gave the PRF output, so open the local copy now and sign in when syncing later.
          if (fallsBack(e) && prfOutput !== null && this.record?.credentials.some((c) => c.id === assertion.credentialId) === true) {
            this.unreachable(e);
            step('opening');
            const out = prfOutput;
            prfOutput = null;
            return await this.openLocally(assertion.credentialId, out, gen, signal);
          }
          throw mapApi(e);
        }
        this.sessionStarted('passkey');
        if (this.record !== null && login.vaultId !== this.record.vaultId) throw new VaultError('vault-mismatch');
        const local = this.record?.credentials.find((c) => c.id === assertion.credentialId);
        const server = login.credential;
        const stored: StoredCredential = {
          id: assertion.credentialId,
          prfSalt: local?.prfSalt ?? server.prfSalt,
          wrappedPrivateKey: local?.wrappedPrivateKey ?? server.wrappedPrivateKey,
          publicKey: local?.publicKey ?? server.publicKey,
          delivery: newestDelivery(local?.delivery, login.keys.delivery),
        };
        const history = stored.delivery === local?.delivery ? (this.record?.histories[String(stored.delivery.epoch)] ?? null) : login.keys.history;
        if (prfOutput === null) {
          // Rare: the sign-in prompt gave no PRF output, so one more prompt (abortable, with a backstop).
          step('passkey');
          prfOutput = (await evaluatePrf(creds, [stored.id], online.options.rpId, prompt).catch(rethrowPasskey)).prfOutput;
        }
        step('opening');
        const session = await this.openWithPasskey(login.vaultId, stored, prfOutput, history);
        prfOutput = null;
        this.assertLive(gen, signal);
        const fresh = this.record === null;
        const base = this.record ?? emptyRecord(login.vaultId, this.origin, this.scheduler.now());
        const next = withEpoch(
          { ...base, credentials: upsert(base.credentials, stored), histories: history === null ? base.histories : { ...base.histories, [String(stored.delivery.epoch)]: history } },
          login.keys.epoch,
          this.scheduler.now(),
        );
        if (fresh) await this.putRecord(next);
        else await this.updateRecord((r) => withEpoch({ ...r, credentials: upsert(r.credentials, stored), histories: next.histories }, login.keys.epoch, this.scheduler.now()));
        this.assertLive(gen, signal);
        await this.begin(session, signal);
        if (fresh) return { via: 'passkey', sync: await this.store.sync() };
        void this.store.sync();
        return { via: 'passkey', sync: null };
      } finally {
        wipe(prfOutput);
      }
    });
  }

  /** Open the local copy with a PRF output from one of this device's passkeys (no server). Wipes `prfOutput`. */
  private async openLocally(credentialId: string, prfOutput: Bytes, gen: number, signal: AbortSignal): Promise<UnlockResult> {
    const record = this.record;
    const stored = record?.credentials.find((c) => c.id === credentialId);
    if (record === null || stored === undefined) {
      wipe(prfOutput);
      throw new VaultError('passkey-rejected', 'this passkey is not set up on this device');
    }
    const history = record.histories[String(stored.delivery.epoch)] ?? null;
    const session = await this.openWithPasskey(record.vaultId, stored, prfOutput, history);
    this.assertLive(gen, signal);
    await this.begin(session, signal);
    // Signs in (or shows "offline") when it can; never awaited here.
    void this.store.sync();
    return { via: 'passkey', sync: null };
  }

  /**
   * Unlock with the recovery code. On a device that already holds the vault this works offline.
   * Online, the device first checks the server's recovery version: if the code was replaced, its
   * local copy of the old wrapping is deleted and the old code is refused. On a fresh device it
   * restores: params → auth token → session → wrapped DK → full sync. Typos are reported (as
   * `RecoveryCodeError`) before any network call.
   */
  unlockWithRecoveryCode(input: string, opts: UnlockOptions = {}): Promise<UnlockResult> {
    // Taken now, not when the queued work starts: a lock() issued after this call must win.
    const gen = this.lockGen;
    const ctrl = this.newUnlockAttempt(opts.signal);
    const signal = ctrl.signal;
    const step = (s: UnlockStep) => {
      if (!signal.aborted) opts.onStep?.(s);
    };
    return this.attempt(ctrl, async () => {
      if (this.session !== null) return { via: this.session.via, sync: null };
      const code = await parseRecoveryCode(input);
      let token: Bytes | null = null;
      try {
        let unreachable: VaultError | null = this.isOnline() ? null : new VaultError('offline');
        if (unreachable === null && this.serverSlow()) unreachable = new VaultError('timeout', 'the server was too slow a moment ago');
        const net = { signal, timeoutMs: this.unlockNetworkMs };
        let params: Awaited<ReturnType<ApiClient['recoveryParams']>> | null = null;
        if (unreachable === null) {
          step('signing-in');
          if (!(await this.flushLogout(net))) unreachable = new VaultError('timeout');
          else {
            params = await this.api.recoveryParams(net).catch((e: unknown) => {
              if (isUnreachable(e)) {
                unreachable = this.unreachable(e);
                return null;
              }
              throw e instanceof ApiError && e.kind === 'not-found' ? new VaultError('no-vault', 'the server has no vault yet', { cause: e }) : mapApi(e);
            });
          }
        }
        step('opening');
        if (this.record !== null && params !== null && params.vaultId !== this.record.vaultId) throw new VaultError('vault-mismatch');
        let local = this.record?.recovery ?? null;
        if (local !== null && params !== null && params.version > local.version) {
          // Rotated elsewhere: the old wrapping must not keep opening this device.
          await this.dropRecovery(params.version);
          local = null;
        }

        if (this.record !== null && local !== null) {
          const salt = unb64(local.salt);
          const kek = await deriveRecoveryKek(code.secret, salt);
          const aad = wrapAad(this.record.vaultId, { type: 'recovery', version: local.version });
          const wrapped = unb64(local.wrappedDk);
          const dk = await unwrapDataKey(wrapped, kek, aad).catch(() => null);
          if (dk !== null) {
            token = await deriveRecoveryAuthToken(code.secret, salt);
            const keys = await this.epochKeys(this.record.vaultId, local.version, dk, this.record.histories[String(local.version)] ?? null);
            if (params !== null) {
              step('signing-in');
              const ok = await this.api.recoveryLogin(b64(token), net).then(
                () => true,
                (e: unknown) => {
                  if (e instanceof ApiError && e.kind === 'unauthorized') throw new VaultError('wrong-recovery-code', undefined, { cause: e });
                  if (e instanceof ApiError && e.kind === 'aborted') throw new VaultError('aborted', undefined, { cause: e });
                  return false;
                },
              );
              if (ok) this.sessionStarted('recovery');
              step('opening');
            }
            this.assertLive(gen, signal);
            if (this.record.recoveryChanged) await this.updateRecord((r) => ({ ...r, recoveryChanged: false }));
            await this.begin({ vaultId: this.record.vaultId, via: 'recovery', epoch: local.version, keys, current: { kek, wrapped, aad }, history: historyBytes(this.record.histories[String(local.version)]), credential: null, recoveryToken: token }, signal);
            token = null; // owned by the session now
            void this.store.sync();
            return { via: 'recovery', sync: null };
          }
          if (params === null) throw new VaultError('wrong-recovery-code');
        }

        if (params === null) throw this.record === null || local === null ? (unreachable ?? new VaultError('offline')) : new VaultError('wrong-recovery-code');
        const salt = unb64(params.salt);
        token = await deriveRecoveryAuthToken(code.secret, salt);
        step('signing-in');
        const login = await this.api.recoveryLogin(b64(token), { signal }).catch((e: unknown) => {
          throw e instanceof ApiError && e.kind === 'unauthorized' ? new VaultError('wrong-recovery-code', undefined, { cause: e }) : mapApi(e);
        });
        this.sessionStarted('recovery');
        step('opening');
        const kek = await deriveRecoveryKek(code.secret, salt);
        const aad = wrapAad(params.vaultId, { type: 'recovery', version: login.version });
        const wrapped = unb64(login.wrappedDk);
        const dk = await unwrapDataKey(wrapped, kek, aad).catch((e: unknown) => {
          throw new VaultError('wrong-recovery-code', undefined, { cause: e });
        });
        const keys = await this.epochKeys(params.vaultId, login.version, dk, login.history);
        this.assertLive(gen, signal);
        const recovery: StoredRecovery = { version: login.version, salt: params.salt, wrappedDk: login.wrappedDk };
        const histories = login.history === null ? {} : { [String(login.version)]: login.history };
        if (this.record === null) await this.putRecord({ ...emptyRecord(params.vaultId, this.origin, this.scheduler.now(), login.version), recovery, histories });
        else await this.updateRecord((r) => withEpoch({ ...r, recovery, recoveryChanged: false, histories: { ...r.histories, ...histories } }, login.version, this.scheduler.now()));
        this.assertLive(gen, signal);
        await this.begin({ vaultId: params.vaultId, via: 'recovery', epoch: login.version, keys, current: { kek, wrapped, aad }, history: historyBytes(login.history), credential: null, recoveryToken: token }, signal);
        token = null;
        return { via: 'recovery', sync: await this.store.sync() };
      } finally {
        wipe(code.secret);
        wipe(token);
      }
    });
  }

  /** Get a server session while already unlocked (after an offline unlock or an expired session). One passkey prompt. */
  connect(): Promise<SyncResult> {
    return this.exclusive(async () => {
      this.requireSession();
      await this.passkeyLogin();
      return this.store.sync();
    });
  }

  // --- Changes while unlocked --------------------------------------------------------------------

  /**
   * Register another passkey (this device or a phone/key nearby) for this vault. Needs a session and
   * a fresh proof: a passkey prompt (step-up), or, when unlocked with the recovery code, that code.
   */
  addPasskey(): Promise<{ credentialId: string }> {
    return this.exclusive(async () => {
      const session = this.requireSession();
      const creds = this.requireCredentials();
      if ((await this.prfSupport()) === 'unsupported') throw new VaultError('prf-unavailable');
      await this.flushLogout();
      const stepUp: StepUp = session.recoveryToken !== null ? { authToken: b64(session.recoveryToken) } : await this.passkeyStepUp('register');
      const opts = await this.api.registerOptions(null).catch((e: unknown) => {
        throw mapApi(e);
      });
      const prfSalt = randomBytes(SALT_BYTES);
      const pk = await createPasskey(creds, opts.options).catch((e: unknown) => {
        throw mapPasskey(e);
      });
      let prfOutput = pk.prfOutput;
      let raw: Bytes | null = null;
      try {
        // Created on the authenticator but useless for unlocking: don't register it.
        if (prfOutput === null) throw new VaultError('prf-unavailable');
        const kek = await derivePasskeyKek(prfOutput, prfSalt);
        wipe(prfOutput);
        prfOutput = null;
        raw = await this.currentRaw(session);
        const made = await makeCredentialKeys(session.vaultId, pk.credentialId, kek, raw, currentDk(session), session.epoch, prfSalt);
        await this.api
          .registerVerify({ response: pk.response, challengeToken: opts.challengeToken, prfSalt: b64(prfSalt), credentialKey: made.credentialKey, delivery: made.delivery, stepUp })
          .catch((e: unknown) => {
            throw mapApi(e);
          });
        this.sessionStarted('passkey');
        await this.updateRecord((r) => ({ ...r, credentials: upsert(r.credentials, made.stored) }));
        return { credentialId: pk.credentialId };
      } finally {
        wipe(prfOutput);
        wipe(raw);
      }
    });
  }

  /**
   * Replace the recovery code (after printing a new kit). Starts a new data-key epoch: the new key
   * goes to every registered passkey and under the new code, and the older keys are sealed under it.
   * The old code then opens nothing written from now on, signs in nowhere, and is dropped by every
   * device on its next sync. Needs a passkey on this device (one prompt). Returns the new code ONCE.
   */
  rotateRecoveryCode(): Promise<{ recoveryCode: string }> {
    return this.exclusive(async () => {
      const session = this.requireSession();
      this.requireCredentials();
      if (this.knownCredentials().length === 0) throw new VaultError('no-passkey', 'add a passkey on this device before making a new recovery code');
      await this.flushLogout();
      // Rotation needs a passkey session; a recovery-code session can't rotate.
      if (this.serverSession !== 'passkey') await this.passkeyLogin();
      await this.refresh();
      const params = await this.api.recoveryParams().catch((e: unknown) => {
        throw mapApi(e);
      });
      if (params.vaultId !== session.vaultId) throw new VaultError('vault-mismatch');
      if (params.version !== session.epoch) throw new VaultError('server', `the server is at epoch ${params.version}, this device at ${session.epoch}`);
      const stepUp = await this.passkeyStepUp('rotate');

      // Only deliver the new key to passkeys vouched for under the CURRENT key: registered in this
      // epoch, or re-bound by the rotation that started it. An old key (which an old recovery code
      // yields) can't vouch for anything any more, so a record planted with one fails here.
      const list = await this.api.credentials().catch((e: unknown) => {
        throw mapApi(e);
      });
      const current = currentDk(session);
      for (const c of list) {
        const ok = c.epoch === session.epoch && (await verifyCredentialBinding(current, session.vaultId, c.id, c.epoch, unb64(c.publicKey), unb64(c.binding)));
        if (!ok) throw new VaultError('server', 'a passkey record on the server is not vouched for by the current key; it may have been planted');
      }

      const version = session.epoch + 1;
      const rawNew = newDataKeyBytes();
      let rawCur: Bytes | null = null;
      let rawOlder: Bytes | null = null;
      let all: Bytes | null = null;
      let secret: Bytes | null = null;
      let token: Bytes | null = null;
      try {
        rawCur = await this.currentRaw(session);
        rawOlder = session.history === null ? new Uint8Array(0) : await openHistoryBytes(session.history, currentDk(session), session.vaultId, session.epoch);
        all = concatBytes(rawOlder, rawCur);
        const newDk = await importDataKey(rawNew);
        const history = await sealHistory(all, newDk, session.vaultId, version);
        const deliveries: Record<string, { ephemeralPublicKey: string; wrappedDk: string; binding: string }> = {};
        for (const c of list) {
          const pub = unb64(c.publicKey);
          const d = await deliverDataKey(rawNew, pub, session.vaultId, version, c.id);
          // Re-bind under the new key: only this vouches for the passkey at the next rotation.
          const binding = await bindCredential(newDk, session.vaultId, c.id, version, pub);
          deliveries[c.id] = { ephemeralPublicKey: b64(d.ephemeralPublicKey), wrappedDk: b64(d.wrappedDk), binding: b64(binding) };
        }
        const code = await generateRecoveryCode();
        secret = code.secret;
        const salt = randomBytes(SALT_BYTES);
        const kek = await deriveRecoveryKek(secret, salt);
        token = await deriveRecoveryAuthToken(secret, salt);
        const aad = wrapAad(session.vaultId, { type: 'recovery', version });
        const wrapped = await wrapDataKey(rawNew, kek, aad);
        const res = await this.api
          .recoveryRotate({ version, salt: b64(salt), authVerifier: b64(await authVerifier(token)), wrappedDk: b64(wrapped), history: b64(history), deliveries, stepUp })
          .catch((e: unknown) => {
            throw mapApi(e);
          });
        if (res.version !== version) throw new VaultError('server', `server stored recovery version ${res.version}, expected ${version}`);

        const historyText = b64(history);
        await this.updateRecord((r) => ({
          ...withEpoch(r, version, this.scheduler.now()),
          recovery: { version, salt: b64(salt), wrappedDk: b64(wrapped) },
          recoveryChanged: false,
          histories: { ...r.histories, [String(version)]: historyText },
          credentials: r.credentials.map((c) => {
            const d = deliveries[c.id];
            return d === undefined ? c : { ...c, delivery: { epoch: version, ephemeralPublicKey: d.ephemeralPublicKey, wrappedDk: d.wrappedDk } };
          }),
        }));
        if (this.session === session) {
          session.keys.set(version, newDk);
          session.epoch = version;
          session.current = { kek, wrapped, aad };
          session.history = history;
          wipe(session.recoveryToken);
          session.recoveryToken = null;
          this.store.setKeys(storeKeys(session));
        }
        return { recoveryCode: code.text };
      } finally {
        wipe(rawNew);
        wipe(rawCur);
        wipe(rawOlder);
        wipe(all);
        wipe(secret);
        wipe(token);
      }
    });
  }

  /** Pull and push now (e.g. on a "Sync" button). */
  sync(): Promise<SyncResult> {
    return this.store.sync();
  }

  // --- Lock --------------------------------------------------------------------------------------

  /**
   * Drop the data keys and every plaintext entry, and end the server session (revoked on the
   * server; queued until the next time online if offline). A lock during an unlock wins.
   */
  lock(reason: LockReason = 'user'): void {
    this.lockGen++;
    if (this.session === null) return;
    wipe(this.session.recoveryToken);
    this.session = null;
    this.serverSession = null;
    this.store.stop();
    this.clearIdle();
    this.hiddenAt = null;
    this.lockReason = reason;
    this.endServerSession();
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
    this.lockGen++;
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

  // --- Internals: keys ---------------------------------------------------------------------------

  /** Unwrap a passkey's ECDH key with its PRF output, open its newest delivery and that epoch's history. Wipes `prfOutput`. */
  private async openWithPasskey(vaultId: string, cred: StoredCredential, prfOutput: Bytes, history: string | null): Promise<Session> {
    let kek: CryptoKey;
    try {
      kek = await derivePasskeyKek(prfOutput, unb64(cred.prfSalt));
    } finally {
      wipe(prfOutput);
    }
    const rejected = (e: unknown) => {
      throw e instanceof KeyError ? new VaultError('passkey-rejected', 'this passkey does not open this vault', { cause: e }) : e;
    };
    const publicKey = unb64(cred.publicKey);
    const privateKey = await unwrapCredentialKey(unb64(cred.wrappedPrivateKey), kek, credentialKeyAad(vaultId, cred.id)).catch(rejected);
    const { epoch } = cred.delivery;
    const delivery = { ephemeralPublicKey: unb64(cred.delivery.ephemeralPublicKey), wrappedDk: unb64(cred.delivery.wrappedDk) };
    const opened = await openDelivery(privateKey, publicKey, delivery, vaultId, epoch, cred.id).catch(rejected);
    const dk = await unwrapDataKey(delivery.wrappedDk, opened.kek, opened.aad).catch(rejected);
    const keys = await this.epochKeys(vaultId, epoch, dk, history);
    return {
      vaultId,
      via: 'passkey',
      epoch,
      keys,
      current: { kek: opened.kek, wrapped: delivery.wrappedDk, aad: opened.aad },
      history: historyBytes(history),
      credential: { id: cred.id, privateKey, publicKey },
      recoveryToken: null,
    };
  }

  /** DK_epoch plus the older keys from its history. */
  private async epochKeys(vaultId: string, epoch: number, dk: CryptoKey, history: string | null): Promise<Map<number, CryptoKey>> {
    const keys = epoch > 1 && history !== null ? await openHistory(unb64(history), dk, vaultId, epoch).catch((e: unknown) => {
      throw new VaultError('server', 'the key history does not open', { cause: e });
    }) : new Map<number, CryptoKey>();
    keys.set(epoch, dk);
    return keys;
  }

  /** Raw bytes of the current DK, only to wrap a new copy. The caller must wipe them. */
  private currentRaw(session: Session): Promise<Bytes> {
    return unwrapDataKeyBytes(session.current.wrapped, session.current.kek, session.current.aad);
  }

  /**
   * Before every sync: end a queued logout, check the server's recovery version and epoch. A newer
   * version means the code was rotated elsewhere: drop the local recovery wrapping (and show
   * `recoveryCodeChanged`), and, if this session holds a passkey key, fetch the new epoch's key.
   */
  private refresh(): Promise<void> {
    this.refreshing ??= this.refreshOnce().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshOnce(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    await this.flushLogout();
    const params = await this.api.recoveryParams();
    if (this.session !== session) return;
    if (params.vaultId !== session.vaultId) throw new VaultError('vault-mismatch');
    const rec = this.record?.recovery ?? null;
    if (rec !== null && params.version > rec.version) await this.dropRecovery(params.version);
    else if ((this.record?.epoch ?? 0) < params.version) await this.updateRecord((r) => withEpoch(r, params.version, this.scheduler.now()));
    if (params.version <= session.epoch || session.credential === null || this.serverSession === 'recovery') return;

    const cred = session.credential;
    const k = await this.api.keys(cred.id);
    if (this.session !== session || k.delivery === null || k.delivery.epoch <= session.epoch) return;
    const d = { ephemeralPublicKey: unb64(k.delivery.ephemeralPublicKey), wrappedDk: unb64(k.delivery.wrappedDk) };
    const opened = await openDelivery(cred.privateKey, cred.publicKey, d, session.vaultId, k.delivery.epoch, cred.id);
    const dk = await unwrapDataKey(d.wrappedDk, opened.kek, opened.aad);
    const keys = await this.epochKeys(session.vaultId, k.delivery.epoch, dk, k.history);
    // Other passkeys on this device: keep their newest deliveries, so they too unlock offline.
    const others: Record<string, DeliveryJSON> = {};
    for (const c of this.record?.credentials ?? []) {
      if (c.id === cred.id) continue;
      const o = await this.api.keys(c.id).catch(() => null);
      if (o?.delivery) others[c.id] = o.delivery;
    }
    if (this.session !== session) return;
    const fresh = { ...k.delivery };
    await this.updateRecord((r) =>
      withEpoch(
        {
          ...r,
          histories: k.history === null ? r.histories : { ...r.histories, [String(fresh.epoch)]: k.history },
          credentials: r.credentials.map((c) => {
            const nd = c.id === cred.id ? fresh : others[c.id];
            return nd === undefined || nd.epoch <= c.delivery.epoch ? c : { ...c, delivery: nd };
          }),
        },
        k.epoch,
        this.scheduler.now(),
      ),
    );
    if (this.session !== session) return;
    for (const [e, key] of keys) session.keys.set(e, key);
    session.epoch = fresh.epoch;
    session.current = { kek: opened.kek, wrapped: d.wrappedDk, aad: opened.aad };
    session.history = historyBytes(k.history);
    this.store.setKeys(storeKeys(session));
  }

  /** The recovery code was rotated elsewhere: forget the outdated local wrapping and raise the notice. */
  private async dropRecovery(version: number): Promise<void> {
    await this.updateRecord((r) => withEpoch({ ...r, recovery: null, recoveryChanged: true }, version, this.scheduler.now()));
  }

  // --- Internals: server session -----------------------------------------------------------------

  /** Passkey sign-in while unlocked (one prompt): a passkey server session. */
  private async passkeyLogin(): Promise<void> {
    const creds = this.requireCredentials();
    const known = this.knownCredentials();
    if (known.length === 0) throw new VaultError('no-passkey');
    await this.flushLogout();
    const opts = await this.api.loginOptions().catch((e: unknown) => {
      throw mapApi(e);
    });
    const a = await getAssertion(creds, opts.options, known).catch((e: unknown) => {
      throw mapPasskey(e);
    });
    let prfOutput = a.prfOutput;
    try {
      const login = await this.api.loginVerify({ response: a.response, challengeToken: opts.challengeToken }).catch((e: unknown) => {
        throw e instanceof ApiError && e.kind === 'unauthorized' ? new VaultError('passkey-rejected', undefined, { cause: e }) : mapApi(e);
      });
      this.sessionStarted('passkey');
      if (login.vaultId !== this.record?.vaultId) throw new VaultError('vault-mismatch');
      // Unlocked with the recovery code: take this passkey's key too, so newer epochs reach this session.
      const session = this.session;
      const local = this.record.credentials.find((c) => c.id === a.credentialId);
      if (session !== null && session.credential === null && prfOutput !== null && local !== undefined) {
        const stored: StoredCredential = { ...local, delivery: newestDelivery(local.delivery, login.keys.delivery) };
        const history = stored.delivery === local.delivery ? (this.record.histories[String(stored.delivery.epoch)] ?? null) : login.keys.history;
        const opened = await this.openWithPasskey(login.vaultId, stored, prfOutput, history).catch(() => null);
        prfOutput = null;
        if (opened !== null && this.session === session) {
          session.credential = opened.credential;
          for (const [e, k] of opened.keys) if (!session.keys.has(e)) session.keys.set(e, k);
          if (opened.epoch > session.epoch) {
            session.epoch = opened.epoch;
            session.current = opened.current;
            session.history = opened.history;
          }
          await this.updateRecord((r) => withEpoch({ ...r, credentials: upsert(r.credentials, stored), histories: history === null ? r.histories : { ...r.histories, [String(stored.delivery.epoch)]: history } }, login.keys.epoch, this.scheduler.now()));
          this.store.setKeys(storeKeys(session));
        }
      }
    } finally {
      wipe(prfOutput);
    }
  }

  /** A fresh passkey assertion over a step-up challenge for `purpose` (one prompt). */
  private async passkeyStepUp(purpose: 'register' | 'rotate'): Promise<StepUp> {
    const creds = this.requireCredentials();
    const known = this.knownCredentials();
    if (known.length === 0) throw new VaultError('no-passkey');
    if (this.serverSession !== 'passkey') await this.passkeyLogin();
    const opts = await this.api.stepUpOptions(purpose).catch((e: unknown) => {
      throw mapApi(e);
    });
    const a = await getAssertion(creds, opts.options, known).catch((e: unknown) => {
      throw mapPasskey(e);
    });
    wipe(a.prfOutput);
    return { response: a.response, challengeToken: opts.challengeToken };
  }

  /**
   * End the server session: now if online, else queued (and remembered across reloads). Any failure
   * (offline, 5xx, 429, …) queues it too, until it succeeds or a new sign-in replaces the cookie.
   */
  private endServerSession(): void {
    if (!this.isOnline()) {
      this.markLogoutPending(true);
      return;
    }
    const signIns = this.signIns;
    const p: Promise<void> = this.api
      .logout()
      .catch(() => {
        // Only while no newer sign-in replaced the cookie: a queued logout would end THAT session.
        if (this.signIns === signIns) this.markLogoutPending(true);
      })
      .finally(() => {
        if (this.logoutInFlight === p) this.logoutInFlight = null;
      });
    this.logoutInFlight = p;
  }

  /**
   * Send a queued logout before anything else talks to the server. A failure keeps it queued.
   * Returns false when the server could not be reached in time (the caller may go offline). A
   * logout still in flight carries the OLD cookie, so a sign-in may go ahead without waiting for it.
   */
  private async flushLogout(opts: RequestOptions = {}): Promise<boolean> {
    const inFlight = this.logoutInFlight;
    if (inFlight !== null) {
      if (opts.timeoutMs === undefined) await inFlight;
      else if (!(await settleWithin(inFlight, opts.timeoutMs, opts.signal))) {
        if (isAborted(opts.signal)) throw new VaultError('aborted');
        return false;
      }
    }
    if (isAborted(opts.signal)) throw new VaultError('aborted');
    if (!this.logoutPending || !this.isOnline()) return true;
    try {
      await this.api.logout(opts);
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'aborted') throw new VaultError('aborted', undefined, { cause: e });
      if (e instanceof ApiError && e.kind === 'timeout') this.unreachable(e);
      return !isUnreachable(e);
    }
    this.markLogoutPending(false);
    return true;
  }

  /** Remember a timeout (unlocks skip the server for a while) and return the error to report. */
  private unreachable(e: unknown): VaultError {
    if (e instanceof ApiError && e.kind === 'timeout') {
      this.serverSlowUntil = this.scheduler.now() + SLOW_SERVER_MS;
      return new VaultError('timeout', undefined, { cause: e });
    }
    return new VaultError('offline', undefined, { cause: e });
  }

  private serverSlow(): boolean {
    return this.scheduler.now() < this.serverSlowUntil;
  }

  /**
   * A sign-in set a new session cookie. The old cookie is gone from the browser, so a still-queued
   * logout could now only end the NEW session: drop it.
   */
  private sessionStarted(kind: 'passkey' | 'recovery'): void {
    this.serverSession = kind;
    this.signIns++;
    this.serverSlowUntil = 0;
    if (this.logoutPending) this.markLogoutPending(false);
  }

  /**
   * Before sealing: never seal under an older epoch than the newest the device knows (that key may
   * be one a leaked old code opens). Fetch the newer key first, or refuse the write.
   */
  private async ensureNewestKey(): Promise<void> {
    const session = this.session;
    if (session === null || session.epoch >= (this.record?.epoch ?? 0)) return;
    if (this.isOnline()) await this.refresh().catch(() => undefined);
    if (this.session !== session || session.epoch >= (this.record?.epoch ?? 0)) return;
    throw new VaultError(
      session.credential !== null || this.knownCredentials().length > 0 ? 'needs-session' : 'recovery-code-changed',
      'a newer data key exists; sign in again (or unlock with the new recovery code) before writing',
    );
  }

  private markLogoutPending(pending: boolean): void {
    this.logoutPending = pending;
    if (this.record !== null && this.record.logoutPending !== pending) void this.updateRecord((r) => ({ ...r, logoutPending: pending })).catch(() => undefined);
  }

  // --- Internals: state --------------------------------------------------------------------------

  private async begin(session: Session, signal?: AbortSignal): Promise<void> {
    // Decrypt the local copy first, then report "unlocked": the app must never render an unlocked
    // book whose `list()` is still empty. This never waits for the network.
    const gen = this.lockGen;
    if (isAborted(signal)) {
      wipe(session.recoveryToken);
      throw new VaultError('aborted');
    }
    await this.store.start(storeKeys(session));
    if (gen !== this.lockGen || isAborted(signal)) {
      this.store.stop();
      wipe(session.recoveryToken);
      throw gen !== this.lockGen ? new VaultError('locked', 'the vault was locked while unlocking') : new VaultError('aborted');
    }
    this.session = session;
    this.lockReason = null;
    this.hiddenAt = null;
    this.touch();
    this.scheduleIdle();
    this.emit();
  }

  private assertGen(gen: number): void {
    if (gen !== this.lockGen) throw new VaultError('locked', 'the vault was locked while unlocking');
  }

  /** Neither locked nor abandoned since the attempt started. */
  private assertLive(gen: number, signal: AbortSignal): void {
    this.assertGen(gen);
    if (signal.aborted) throw new VaultError('aborted');
  }

  /** A new unlock attempt: the one still running (a hidden prompt, a slow server) is abandoned. */
  private newUnlockAttempt(external: AbortSignal | undefined): AbortController {
    this.unlockCtrl?.abort();
    const ctrl = linkedController(external);
    this.unlockCtrl = ctrl;
    return ctrl;
  }

  /** Run an unlock attempt in the queue; an abort releases the queue at once. */
  private attempt<T>(ctrl: AbortController, fn: () => Promise<T>): Promise<T> {
    return this.exclusive(fn, ctrl.signal).finally(() => {
      if (this.unlockCtrl === ctrl) this.unlockCtrl = null;
    });
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

  /**
   * One operation at a time. With a signal, an abort rejects the caller and frees the queue right
   * away, even if the abandoned work is stuck (it checks the signal before acting on a late result).
   */
  private exclusive<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const aborted = () => new VaultError('aborted', 'this unlock was abandoned');
    const start = (): Promise<T> => (signal?.aborted === true ? Promise.reject(aborted()) : raceAbort(fn(), signal, aborted));
    const run = this.queue.then(start, start);
    this.queue = run.catch(() => undefined);
    return raceAbort(run, signal, aborted);
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
    else {
      this.scheduleIdle();
      // Back in the foreground: pull other devices' changes now instead of waiting for the next poll.
      void this.store.sync();
    }
  };

  private readonly onOnline = () => {
    if (this.session !== null) void this.store.sync();
    else void this.flushLogout();
  };
}

/** New ECDH key pair for a passkey: wrapped private key, delivery of the current DK, binding, and the session's non-extractable copy. */
async function makeCredentialKeys(vaultId: string, credentialId: string, kek: CryptoKey, rawDk: Bytes, dk: CryptoKey, epoch: number, prfSalt: Bytes) {
  const { privateKey: exportable, publicKey } = await generateCredentialKey();
  const aad = credentialKeyAad(vaultId, credentialId);
  const wrappedPrivateKey = await wrapCredentialKey(exportable, kek, aad);
  const privateKey = await unwrapCredentialKey(wrappedPrivateKey, kek, aad);
  const d = await deliverDataKey(rawDk, publicKey, vaultId, epoch, credentialId);
  const binding = await bindCredential(dk, vaultId, credentialId, epoch, publicKey);
  const delivery: StoredDelivery = { epoch, ephemeralPublicKey: b64(d.ephemeralPublicKey), wrappedDk: b64(d.wrappedDk) };
  return {
    privateKey,
    publicKey,
    credentialKey: { publicKey: b64(publicKey), wrappedPrivateKey: b64(wrappedPrivateKey), epoch, binding: b64(binding) },
    delivery,
    stored: { id: credentialId, prfSalt: b64(prfSalt), wrappedPrivateKey: b64(wrappedPrivateKey), publicKey: b64(publicKey), delivery } satisfies StoredCredential,
  };
}

function emptyRecord(vaultId: string, origin: string, now: number, epoch = 1): VaultRecord {
  return { format: RECORD_FORMAT, vaultId, recovery: null, credentials: [], epoch, histories: {}, learned: { [String(epoch)]: now }, recoveryChanged: false, logoutPending: false, cursor: null, origin };
}

/**
 * Raise the known epoch (noting when each new one was first heard of); a recovery wrapping older
 * than it is outdated and dropped (with the notice).
 */
function withEpoch(r: VaultRecord, epoch: number, now: number): VaultRecord {
  const e = Math.max(r.epoch, epoch);
  const learned = { ...r.learned };
  for (let n = r.epoch + 1; n <= e; n++) learned[String(n)] ??= now;
  const out = { ...r, epoch: e, learned };
  if (r.recovery !== null && r.recovery.version < e) return { ...out, recovery: null, recoveryChanged: true };
  return out;
}

function upsert(list: readonly StoredCredential[], cred: StoredCredential): StoredCredential[] {
  return [...list.filter((c) => c.id !== cred.id), cred];
}

function newestDelivery(local: StoredDelivery | undefined, server: DeliveryJSON): StoredDelivery {
  return local !== undefined && local.epoch >= server.epoch ? local : { epoch: server.epoch, ephemeralPublicKey: server.ephemeralPublicKey, wrappedDk: server.wrappedDk };
}

function historyBytes(h: string | null | undefined): Bytes | null {
  return h === null || h === undefined ? null : unb64(h);
}

function currentDk(session: Session): CryptoKey {
  const dk = session.keys.get(session.epoch);
  if (dk === undefined) throw new VaultError('locked', 'no key for the current epoch');
  return dk;
}

function storeKeys(session: Session) {
  return { vaultId: session.vaultId, epoch: session.epoch, keys: session.keys };
}

function mapApi(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  if (e.kind === 'network') return new VaultError('offline', undefined, { cause: e });
  if (e.kind === 'timeout') return new VaultError('timeout', undefined, { cause: e });
  if (e.kind === 'aborted') return new VaultError('aborted', undefined, { cause: e });
  if (e.kind === 'unauthorized') return new VaultError('needs-session', undefined, { cause: e });
  return e;
}

function mapPasskey(e: unknown): unknown {
  if (!(e instanceof PasskeyError)) return e;
  if (e.code === 'prf-unavailable') return new VaultError('prf-unavailable', undefined, { cause: e });
  if (e.code === 'unsupported') return new VaultError('passkeys-unsupported', undefined, { cause: e });
  if (e.code === 'no-credential') return new VaultError('no-passkey', undefined, { cause: e });
  if (e.code === 'aborted') return new VaultError('aborted', undefined, { cause: e });
  if (e.code === 'timeout') return new VaultError('passkey-timeout', undefined, { cause: e });
  return e;
}

function rethrowPasskey(e: unknown): never {
  throw mapPasskey(e);
}

/** A server problem an unlock can step around by opening the local copy: unreachable, too slow, 5xx, 429. */
function fallsBack(e: unknown): boolean {
  return isUnreachable(e) || (e instanceof ApiError && (e.kind === 'server' || e.kind === 'rate-limited'));
}
