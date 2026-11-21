/**
 * A `LedgerStore` backed by the vault: entries are sealed into the `outbox`, uploaded when online,
 * and every blob the server holds is pulled into `blobs`, so each device keeps a full copy.
 *
 * Plaintext entries live only in memory, only while the vault is unlocked. `list()` order is the
 * same on every device once synced: server blobs in key order (entries in blob order), then
 * entries not yet uploaded. An entry id seen twice keeps its first occurrence in that order;
 * identical copies (a retried upload) are dropped silently, different content under one id is
 * counted in `status.conflicts`.
 *
 * Blobs are sealed under the newest data-key epoch the vault knows; each blob names its epoch, so
 * older blobs open with older keys. Outbox blobs sealed under an older epoch (written offline, or
 * before a rotation) are re-sealed under the current one before upload: the server accepts only the
 * current epoch, and answers 409 to anything else, which makes the next sync refresh the keys first.
 *
 * Pulling lists from ten minutes before the last key held (see "Listing cursor" in the protocol)
 * and skips keys already held; the first sync after unlock, and one every six hours, lists from the
 * start and counts blobs the server no longer has (`status.missingOnServer`).
 */
import { parseEntry, type Entry } from '@bitcoin-basis/engine';
import type { LedgerStore } from '../data/ledger-store.ts';
import { ApiError, MAX_PAGE, type ApiClient, isUnreachable } from './api.ts';
import { toHex, randomBytes, toBytes, type Bytes } from './bytes.ts';
import { randomUnit, type BroadcastLike, type Scheduler } from './env.ts';
import { VaultError } from './errors.ts';
import type { DbOp, VaultDb } from './idb.ts';
import { RECORD_KEY, parseRecord, type VaultRecord } from './record.ts';
import { blobEpoch, isValidBlobSize, openBlob, sealEntries } from './seal.ts';

export type SyncPhase =
  /** Locked: nothing in memory. */
  | 'off'
  | 'idle'
  | 'syncing'
  | 'offline'
  /** The server needs a sign-in before it accepts or returns blobs (`vault.connect()`). */
  | 'signed-out'
  | 'error';

export interface SyncStatus {
  readonly phase: SyncPhase;
  /** Sealed blobs waiting in the outbox. */
  readonly pending: number;
  readonly lastSyncedAt: number | null;
  /** Blobs that failed to decrypt or validate (never shown, kept out of the ledger). */
  readonly rejected: number;
  /** Entry ids seen with different content (the first in canonical order wins). */
  readonly conflicts: number;
  /** Blobs this device holds that the server no longer lists (found by the last full compare). */
  readonly missingOnServer: number;
  /**
   * Blobs sealed under an older data key that the server listed only after this device had learned
   * of a newer one (stamped more than ten minutes later). An honest server refuses such uploads, so
   * they are refused here as possible forgeries by someone holding a revoked key (an old recovery code).
   */
  readonly staleEpoch: number;
  readonly error: string | null;
}

export type SyncResult = { readonly ok: true; readonly pulled: number; readonly pushed: number } | { readonly ok: false; readonly reason: 'locked' | 'offline' | 'signed-out' | 'error' };

export interface EncryptedStoreDeps {
  readonly db: VaultDb;
  readonly api: ApiClient;
  readonly scheduler: Scheduler;
  readonly isOnline: () => boolean;
  /** Pull again this long after a successful sync; 0 disables polling. */
  readonly pollIntervalMs: number;
  readonly channel: BroadcastLike | null;
  readonly onStatus: (status: SyncStatus) => void;
  /** Runs at the start of every online sync, before any upload (the vault checks the epoch and recovery version). */
  readonly beforeSync?: () => Promise<void>;
  /**
   * Runs before sealing new entries: never seal under an older epoch than the newest one the device
   * knows. The vault fetches the newer key (calling `setKeys`) or throws.
   */
  readonly beforeSeal?: () => Promise<void>;
}

const EMPTY: readonly Entry[] = Object.freeze([]);
const MAX_BACKOFF_MS = 5 * 60_000;
const OFF: SyncStatus = { phase: 'off', pending: 0, lastSyncedAt: null, rejected: 0, conflicts: 0, missingOnServer: 0, staleEpoch: 0, error: null };
/** Overlap when listing: uploads are stamped when they start, so a slow one can land behind a listed key. */
export const LIST_OVERLAP_MS = 10 * 60_000;
/** A full compare (list from the start) on the first sync after unlock and at least this often. */
export const FULL_COMPARE_MS = 6 * 60 * 60_000;

/** The `after` to list from: ten minutes before the last key's server time, or `null` (from the start). */
export function listAfter(cursor: string | null): string | null {
  const m = cursor === null ? null : /^e\/(\d{13})/.exec(cursor);
  if (m === null) return null;
  return `e/${String(Math.max(0, Number(m[1]) - LIST_OVERLAP_MS)).padStart(13, '0')}`;
}

/** The data keys the store can use: `epoch` seals new blobs; `keys` opens blobs of any epoch it holds. */
export interface StoreKeys {
  readonly vaultId: string;
  readonly epoch: number;
  readonly keys: ReadonlyMap<number, CryptoKey>;
}
type Keys = StoreKeys;

export class EncryptedLedgerStore implements LedgerStore {
  private keys: Keys | null = null;
  /** Bumped by every start/stop; async work from an older generation is discarded. */
  private gen = 0;
  private readonly blobEntries = new Map<string, readonly Entry[]>();
  private readonly outboxEntries = new Map<string, readonly Entry[]>();
  /** Server keys whose blobs failed to open (not stored, not retried this session). */
  private readonly rejectedKeys = new Set<string>();
  /** Local blobs and outbox items that could not be opened with the keys held (retried after `setKeys`). */
  private readonly unreadable = new Set<string>();
  /** Server keys refused as old-epoch blobs listed after a newer epoch was known (see `SyncStatus.staleEpoch`). */
  private readonly staleKeys = new Set<string>();
  /** One retry per run after the server refused an upload for its epoch (409). */
  private conflictRetried = false;
  private view: readonly Entry[] = EMPTY;
  /** True once the local copy has been decrypted after `start` (false while locked). */
  private loadedLocal = false;
  private readonly listeners = new Set<() => void>();
  private running: Promise<SyncResult> | null = null;
  private again = false;
  private timer: unknown = null;
  private attempt = 0;
  private seq = 0;
  private lastFullCompare: number | null = null;
  private current: SyncStatus = OFF;
  private readonly onMessage = () => {
    if (this.keys !== null) void this.reload(this.gen);
  };

  constructor(private readonly deps: EncryptedStoreDeps) {
    deps.channel?.addEventListener('message', this.onMessage);
  }

  // --- LedgerStore -------------------------------------------------------------------------------

  list(): Promise<readonly Entry[]> {
    return Promise.resolve(this.view);
  }

  async append(add: readonly Entry[]): Promise<void> {
    this.requireKeys();
    const gen = this.gen;
    await this.deps.beforeSeal?.();
    if (gen !== this.gen) throw new VaultError('locked');
    const keys = this.requireKeys();
    const have = new Set(this.view.map((e) => e.id));
    const fresh: Entry[] = [];
    for (const e of add) {
      const r = parseEntry(e);
      if (!r.ok) throw new TypeError(`invalid entry ${String((e as { id?: unknown }).id)}: ${r.error}`);
      if (have.has(e.id)) continue;
      have.add(e.id);
      fresh.push(e);
    }
    if (fresh.length === 0) return;
    const sealed = await sealEntries(currentKey(keys), keys.vaultId, keys.epoch, fresh);
    if (gen !== this.gen) throw new VaultError('locked');
    const ops: DbOp[] = [];
    const added: [string, readonly Entry[]][] = [];
    for (const s of sealed) {
      const key = this.outboxKey();
      ops.push({ type: 'put', store: 'outbox', key, value: s.blob });
      added.push([key, s.entries]);
    }
    await this.deps.db.write(ops);
    if (gen !== this.gen) return;
    for (const [k, v] of added) this.outboxEntries.set(k, v);
    this.changed();
    this.deps.channel?.postMessage({ type: 'changed' });
    void this.sync();
  }

  clear(): Promise<void> {
    return Promise.reject(new VaultError('append-only', 'the encrypted ledger is append-only; record a delete entry instead'));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  // --- Lifecycle (called by the vault) -----------------------------------------------------------

  get status(): SyncStatus {
    return this.current;
  }

  /** The local copy is decrypted and in `list()` (never waits for the network). */
  isLoaded(): boolean {
    return this.loadedLocal;
  }

  get unlocked(): boolean {
    return this.keys !== null;
  }

  /** Load and decrypt everything stored on this device. Does not touch the network. */
  async start(keys: Keys): Promise<void> {
    await this.load(this.open(keys));
  }

  /**
   * Take the keys (dropping anything held before) and return this start's token. Pass the token to
   * `load`, and to `stop` when the start fails: a stale `stop(token)` never wipes a newer start.
   */
  open(keys: Keys): number {
    this.stop();
    this.keys = keys;
    this.setStatus({ ...OFF, phase: 'idle' });
    return this.gen;
  }

  /** Decrypt the local copy for the start `token` names. Rejects if that start was replaced or stopped meanwhile. */
  async load(token: number): Promise<void> {
    if (token !== this.gen) throw new VaultError('locked', 'the store was stopped while opening');
    await this.reload(token);
    if (token !== this.gen) throw new VaultError('locked', 'the store was stopped while opening');
  }

  /** New keys (a newer epoch, or older keys now available). Re-reads anything that failed to open. */
  setKeys(keys: Keys): void {
    if (this.keys === null) return;
    this.keys = keys;
    this.rejectedKeys.clear();
    this.lastFullCompare = null;
    void this.reload(this.gen);
  }

  /** Drop the key and every plaintext entry, cancel sync. With a `token` (from `open`), only if that start is still the current one. */
  stop(token?: number): void {
    if (token !== undefined && token !== this.gen) return;
    this.gen++;
    this.keys = null;
    this.blobEntries.clear();
    this.outboxEntries.clear();
    this.rejectedKeys.clear();
    this.unreadable.clear();
    this.staleKeys.clear();
    this.running = null;
    this.again = false;
    this.attempt = 0;
    this.lastFullCompare = null;
    this.clearTimer();
    const hadData = this.view.length > 0;
    this.view = EMPTY;
    const wasLoaded = this.loadedLocal;
    this.loadedLocal = false;
    this.setStatus(OFF);
    if (hadData || wasLoaded) this.notify();
  }

  dispose(): void {
    this.stop();
    this.deps.channel?.removeEventListener('message', this.onMessage);
  }

  /** Upload the outbox, then pull every new blob. A call during a run makes that run go once more, and shares its result. */
  sync(): Promise<SyncResult> {
    if (this.keys === null) return Promise.resolve({ ok: false, reason: 'locked' });
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    const gen = this.gen;
    let run: Promise<SyncResult> | null = null;
    run = (async (): Promise<SyncResult> => {
      await Promise.resolve(); // so `run` is assigned before the loop can finish
      try {
        let result: SyncResult;
        this.conflictRetried = false;
        do {
          this.again = false;
          result = await this.syncOnce(gen);
        } while (this.again && gen === this.gen);
        return result;
      } finally {
        // Cleared together with the last result, so a later call starts a fresh run.
        if (this.running === run) this.running = null;
      }
    })();
    this.running = run;
    return run;
  }

  // --- Internals ---------------------------------------------------------------------------------

  private async syncOnce(gen: number): Promise<SyncResult> {
    this.clearTimer();
    if (!this.deps.isOnline()) {
      this.setStatus({ ...this.current, phase: 'offline', error: null });
      this.retryLater(gen);
      return { ok: false, reason: 'offline' };
    }
    this.setStatus({ ...this.current, phase: 'syncing', error: null });
    try {
      await this.deps.beforeSync?.();
      if (gen !== this.gen) return { ok: false, reason: 'locked' };
      await this.reseal(gen);
      const pushed = await this.upload(gen);
      const pulled = await this.pull(gen);
      if (gen !== this.gen) return { ok: false, reason: 'locked' };
      this.attempt = 0;
      this.setStatus({ ...this.current, phase: 'idle', lastSyncedAt: this.deps.scheduler.now(), error: null });
      if (this.deps.pollIntervalMs > 0) this.timer = this.deps.scheduler.setTimeout(() => void this.sync(), this.deps.pollIntervalMs);
      return { ok: true, pulled, pushed };
    } catch (e) {
      if (gen !== this.gen) return { ok: false, reason: 'locked' };
      if (e instanceof ApiError && e.kind === 'conflict' && !this.conflictRetried) {
        // The server moved to a newer epoch than this upload: refresh the keys and go again.
        this.conflictRetried = true;
        this.again = true;
        return { ok: false, reason: 'error' };
      }
      if (e instanceof ApiError && e.kind === 'unauthorized') {
        this.setStatus({ ...this.current, phase: 'signed-out', error: null });
        return { ok: false, reason: 'signed-out' };
      }
      const offline = isUnreachable(e);
      this.setStatus({ ...this.current, phase: offline ? 'offline' : 'error', error: offline ? null : String((e as Error).message ?? e) });
      this.retryLater(gen);
      return { ok: false, reason: offline ? 'offline' : 'error' };
    }
  }

  /** Re-seal outbox blobs from older epochs under the current one (one transaction per blob). */
  private async reseal(gen: number): Promise<void> {
    const keys = this.keys;
    if (keys === null) return;
    for (const [localKey, value] of await this.deps.db.entries('outbox')) {
      const blob = asBlob(value);
      if (blob === null || blobEpoch(blob) === keys.epoch) continue;
      const entries = this.outboxEntries.get(localKey) ?? (await this.tryOpen(blob));
      if (entries === null || entries.length === 0) continue; // can't open it yet: keep it
      const sealed = await sealEntries(currentKey(keys), keys.vaultId, keys.epoch, entries);
      if (gen !== this.gen) return;
      const ops: DbOp[] = [{ type: 'delete', store: 'outbox', key: localKey }];
      const added: [string, readonly Entry[]][] = [];
      for (const s of sealed) {
        const key = this.outboxKey();
        ops.push({ type: 'put', store: 'outbox', key, value: s.blob });
        added.push([key, s.entries]);
      }
      await this.deps.db.write(ops);
      if (gen !== this.gen) return;
      this.outboxEntries.delete(localKey);
      this.unreadable.delete(localKey);
      for (const [k, v] of added) this.outboxEntries.set(k, v);
    }
  }

  private async upload(gen: number): Promise<number> {
    let pushed = 0;
    for (const [localKey, value] of await this.deps.db.entries('outbox')) {
      if (gen !== this.gen) return pushed;
      const blob = asBlob(value);
      if (blob === null) {
        await this.deps.db.write([{ type: 'delete', store: 'outbox', key: localKey }]);
        continue;
      }
      if (blobEpoch(blob) !== this.keys?.epoch) continue; // not re-sealable yet
      const { key } = await this.deps.api.uploadBlob(blob);
      await this.deps.db.write([
        { type: 'delete', store: 'outbox', key: localKey },
        { type: 'update', store: 'blobs', key, fn: (old) => old ?? blob },
      ]);
      pushed++;
      if (gen !== this.gen) return pushed;
      const entries = this.outboxEntries.get(localKey) ?? (await this.tryOpen(blob));
      this.outboxEntries.delete(localKey);
      if (!this.blobEntries.has(key)) this.blobEntries.set(key, entries ?? EMPTY);
      this.changed();
    }
    if (pushed > 0) this.deps.channel?.postMessage({ type: 'changed' });
    return pushed;
  }

  private async pull(gen: number): Promise<number> {
    const record = parseRecord(await this.deps.db.get('vault', RECORD_KEY));
    const stored = record?.cursor ?? null;
    const now = this.deps.scheduler.now();
    const full = this.lastFullCompare === null || now - this.lastFullCompare >= FULL_COMPARE_MS;
    let after = full ? null : listAfter(stored);
    const listed = new Set<string>();
    let pulled = 0;
    for (;;) {
      const page = await this.deps.api.listBlobs(after, MAX_PAGE);
      if (gen !== this.gen) return pulled;
      const ops: DbOp[] = [];
      const fresh: [string, readonly Entry[]][] = [];
      let rejected = 0;
      for (const b of page.blobs) {
        listed.add(b.key);
        if (this.blobEntries.has(b.key) || this.rejectedKeys.has(b.key)) continue;
        if (isValidBlobSize(b.data.length) && staleEpoch(record, blobEpoch(b.data), b.key)) {
          this.rejectedKeys.add(b.key);
          this.staleKeys.add(b.key);
          continue;
        }
        const entries = isValidBlobSize(b.data.length) ? await this.tryOpen(b.data) : null;
        if (entries === null) {
          this.rejectedKeys.add(b.key);
          rejected++;
          continue;
        }
        ops.push({ type: 'put', store: 'blobs', key: b.key, value: b.data });
        fresh.push([b.key, entries]);
      }
      const last = page.blobs.at(-1)?.key;
      if (last !== undefined) {
        after = last;
        ops.push({
          type: 'update',
          store: 'vault',
          key: RECORD_KEY,
          fn: (old) => {
            const r = old as VaultRecord | undefined;
            return r && (r.cursor === null || last > r.cursor) ? { ...r, cursor: last } : old;
          },
        });
      }
      await this.deps.db.write(ops);
      if (gen !== this.gen) return pulled;
      for (const [k, v] of fresh) this.blobEntries.set(k, v);
      pulled += fresh.length;
      if (rejected > 0) this.setStatus({ ...this.current, rejected: this.current.rejected + rejected });
      if (this.staleKeys.size !== this.current.staleEpoch) this.setStatus({ ...this.current, staleEpoch: this.staleKeys.size });
      if (fresh.length > 0) {
        this.changed();
        this.deps.channel?.postMessage({ type: 'changed' });
      }
      if (!page.more || page.blobs.length === 0) break;
    }
    if (full) {
      this.lastFullCompare = now;
      let missing = 0;
      for (const k of this.blobEntries.keys()) if (!listed.has(k)) missing++;
      this.setStatus({ ...this.current, missingOnServer: missing });
    }
    return pulled;
  }

  /** Bring memory in line with IndexedDB (start, and after another tab wrote). */
  private async reload(gen: number): Promise<void> {
    const [blobs, outbox] = await Promise.all([this.deps.db.entries('blobs'), this.deps.db.entries('outbox')]);
    const newBlobs: [string, readonly Entry[]][] = [];
    let rejected = 0;
    const nowReadable: string[] = [];
    const stillUnreadable: string[] = [];
    // Decrypt in parallel: a long book can hold hundreds of blobs, and this is what the unlock waits for.
    const todo = blobs.filter(([k]) => !this.blobEntries.has(k) || this.unreadable.has(k));
    const opened = await Promise.all(
      todo.map(async ([k, v]) => {
        const blob = asBlob(v);
        return [k, blob === null ? null : await this.tryOpen(blob)] as const;
      }),
    );
    for (const [k, entries] of opened) {
      const retry = this.unreadable.has(k);
      if (entries === null) {
        stillUnreadable.push(k);
        if (!retry) rejected++;
      } else if (retry) nowReadable.push(k);
      newBlobs.push([k, entries ?? EMPTY]);
    }
    const newOutbox = new Map<string, readonly Entry[]>();
    for (const [k, v] of outbox) {
      const known = this.unreadable.has(k) ? undefined : this.outboxEntries.get(k);
      if (known !== undefined) {
        newOutbox.set(k, known);
        continue;
      }
      const blob = asBlob(v);
      const entries = blob === null ? null : await this.tryOpen(blob);
      if (entries === null) {
        if (!this.unreadable.has(k)) rejected++;
        stillUnreadable.push(k);
      } else nowReadable.push(k);
      newOutbox.set(k, entries ?? EMPTY);
    }
    if (gen !== this.gen) return;
    for (const k of nowReadable) this.unreadable.delete(k);
    for (const k of stillUnreadable) this.unreadable.add(k);
    for (const [k, v] of newBlobs) this.blobEntries.set(k, v);
    this.outboxEntries.clear();
    for (const [k, v] of newOutbox) this.outboxEntries.set(k, v);
    if (rejected > 0) this.setStatus({ ...this.current, rejected: this.current.rejected + rejected });
    this.loadedLocal = true;
    this.changed();
  }

  /** Decrypt a blob and validate its entries; `null` if it can't be opened. Invalid entries are dropped. */
  private async tryOpen(blob: Bytes): Promise<readonly Entry[] | null> {
    const keys = this.keys;
    if (keys === null) return null;
    const epoch = blobEpoch(blob);
    const dk = epoch === null ? undefined : keys.keys.get(epoch);
    if (dk === undefined) return null;
    let raw: unknown[];
    try {
      raw = await openBlob(dk, keys.vaultId, blob);
    } catch {
      return null;
    }
    const out: Entry[] = [];
    for (const item of raw) {
      const r = parseEntry(item);
      if (r.ok) out.push(r.value);
    }
    return out;
  }

  private changed(): void {
    const seen = new Map<string, string>();
    const list: Entry[] = [];
    let conflicts = 0;
    const take = (entries: readonly Entry[]) => {
      for (const e of entries) {
        const prev = seen.get(e.id);
        if (prev === undefined) {
          seen.set(e.id, canonicalJson(e));
          list.push(e);
        } else if (prev !== canonicalJson(e)) {
          conflicts++;
        }
      }
    };
    for (const k of [...this.blobEntries.keys()].sort()) take(this.blobEntries.get(k) as readonly Entry[]);
    for (const k of [...this.outboxEntries.keys()].sort()) take(this.outboxEntries.get(k) as readonly Entry[]);
    this.view = Object.freeze(list);
    this.setStatus({ ...this.current, pending: this.outboxEntries.size, conflicts });
    this.notify();
  }

  private retryLater(gen: number): void {
    if (gen !== this.gen) return;
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 20);
    this.timer = this.deps.scheduler.setTimeout(() => void this.sync(), Math.round(base * (0.5 + randomUnit() * 0.5)));
  }

  private clearTimer(): void {
    if (this.timer !== null) this.deps.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private outboxKey(): string {
    this.seq = (this.seq + 1) % 1_000_000;
    return `${String(this.deps.scheduler.now()).padStart(13, '0')}-${String(this.seq).padStart(6, '0')}-${toHex(randomBytes(4))}`;
  }

  private requireKeys(): Keys {
    if (this.keys === null) throw new VaultError('locked');
    return this.keys;
  }

  private setStatus(next: SyncStatus): void {
    this.current = next;
    this.deps.onStatus(next);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
}

/**
 * True for a blob of an epoch older than the newest one the device knows, stamped (server key time)
 * more than the listing overlap after the device first heard of a newer epoch. Uploads under an
 * older epoch are refused by an honest server once a newer one exists, so such a blob was written
 * into storage directly, by someone holding an old key.
 */
function staleEpoch(record: VaultRecord | null, epoch: number | null, key: string): boolean {
  if (record === null || epoch === null || epoch >= record.epoch) return false;
  const times = Object.entries(record.learned).filter(([e]) => Number(e) > epoch).map(([, t]) => t);
  const ms = /^e\/(\d{13})/.exec(key)?.[1];
  if (times.length === 0 || ms === undefined) return false;
  return Number(ms) > Math.min(...times) + LIST_OVERLAP_MS;
}

function currentKey(keys: Keys): CryptoKey {
  const dk = keys.keys.get(keys.epoch);
  if (dk === undefined) throw new VaultError('locked', 'no key for the current epoch');
  return dk;
}

function asBlob(v: unknown): Bytes | null {
  return v instanceof Uint8Array || v instanceof ArrayBuffer ? toBytes(v) : null;
}

/** JSON with object keys sorted, for comparing entries by content. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
