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
 * Pulling lists from ten minutes before the last key held (see "Listing cursor" in the protocol)
 * and skips keys already held; the first sync after unlock, and one every six hours, lists from the
 * start and counts blobs the server no longer has (`status.missingOnServer`).
 */
import { parseEntry, type Entry } from '@bitcoin-basis/engine';
import type { LedgerStore } from '../data/ledger-store.ts';
import { ApiError, MAX_PAGE, type ApiClient } from './api.ts';
import { toHex, randomBytes, toBytes, type Bytes } from './bytes.ts';
import { randomUnit, type BroadcastLike, type Scheduler } from './env.ts';
import { VaultError } from './errors.ts';
import type { DbOp, VaultDb } from './idb.ts';
import { RECORD_KEY, parseRecord, type VaultRecord } from './record.ts';
import { isValidBlobSize, openBlob, sealEntries } from './seal.ts';

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
}

const EMPTY: readonly Entry[] = Object.freeze([]);
const MAX_BACKOFF_MS = 5 * 60_000;
const OFF: SyncStatus = { phase: 'off', pending: 0, lastSyncedAt: null, rejected: 0, conflicts: 0, missingOnServer: 0, error: null };
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

interface Keys {
  readonly vaultId: string;
  readonly dk: CryptoKey;
}

export class EncryptedLedgerStore implements LedgerStore {
  private keys: Keys | null = null;
  /** Bumped by every start/stop; async work from an older generation is discarded. */
  private gen = 0;
  private readonly blobEntries = new Map<string, readonly Entry[]>();
  private readonly outboxEntries = new Map<string, readonly Entry[]>();
  /** Server keys whose blobs failed to open (not stored, not retried this session). */
  private readonly rejectedKeys = new Set<string>();
  private view: readonly Entry[] = EMPTY;
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
    const keys = this.requireKeys();
    const gen = this.gen;
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
    const sealed = await sealEntries(keys.dk, keys.vaultId, fresh);
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

  get unlocked(): boolean {
    return this.keys !== null;
  }

  /** Load and decrypt everything stored on this device. Does not touch the network. */
  async start(keys: Keys): Promise<void> {
    this.stop();
    this.keys = keys;
    const gen = this.gen;
    this.setStatus({ ...OFF, phase: 'idle' });
    await this.reload(gen);
  }

  /** Drop the key and every plaintext entry, cancel sync. */
  stop(): void {
    this.gen++;
    this.keys = null;
    this.blobEntries.clear();
    this.outboxEntries.clear();
    this.rejectedKeys.clear();
    this.running = null;
    this.again = false;
    this.attempt = 0;
    this.lastFullCompare = null;
    this.clearTimer();
    const hadData = this.view.length > 0;
    this.view = EMPTY;
    this.setStatus(OFF);
    if (hadData) this.notify();
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
      const pushed = await this.upload(gen);
      const pulled = await this.pull(gen);
      if (gen !== this.gen) return { ok: false, reason: 'locked' };
      this.attempt = 0;
      this.setStatus({ ...this.current, phase: 'idle', lastSyncedAt: this.deps.scheduler.now(), error: null });
      if (this.deps.pollIntervalMs > 0) this.timer = this.deps.scheduler.setTimeout(() => void this.sync(), this.deps.pollIntervalMs);
      return { ok: true, pulled, pushed };
    } catch (e) {
      if (gen !== this.gen) return { ok: false, reason: 'locked' };
      if (e instanceof ApiError && e.kind === 'unauthorized') {
        this.setStatus({ ...this.current, phase: 'signed-out', error: null });
        return { ok: false, reason: 'signed-out' };
      }
      const offline = e instanceof ApiError && e.kind === 'network';
      this.setStatus({ ...this.current, phase: offline ? 'offline' : 'error', error: offline ? null : String((e as Error).message ?? e) });
      this.retryLater(gen);
      return { ok: false, reason: offline ? 'offline' : 'error' };
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
    const stored = parseRecord(await this.deps.db.get('vault', RECORD_KEY))?.cursor ?? null;
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
    for (const [k, v] of blobs) {
      if (this.blobEntries.has(k)) continue;
      const blob = asBlob(v);
      const entries = blob === null ? null : await this.tryOpen(blob);
      if (entries === null) rejected++;
      newBlobs.push([k, entries ?? EMPTY]);
    }
    const newOutbox = new Map<string, readonly Entry[]>();
    for (const [k, v] of outbox) {
      const known = this.outboxEntries.get(k);
      if (known !== undefined) {
        newOutbox.set(k, known);
        continue;
      }
      const blob = asBlob(v);
      const entries = blob === null ? null : await this.tryOpen(blob);
      if (entries === null) rejected++;
      newOutbox.set(k, entries ?? EMPTY);
    }
    if (gen !== this.gen) return;
    for (const [k, v] of newBlobs) this.blobEntries.set(k, v);
    this.outboxEntries.clear();
    for (const [k, v] of newOutbox) this.outboxEntries.set(k, v);
    if (rejected > 0) this.setStatus({ ...this.current, rejected: this.current.rejected + rejected });
    this.changed();
  }

  /** Decrypt a blob and validate its entries; `null` if it can't be opened. Invalid entries are dropped. */
  private async tryOpen(blob: Bytes): Promise<readonly Entry[] | null> {
    const keys = this.keys;
    if (keys === null) return null;
    let raw: unknown[];
    try {
      raw = await openBlob(keys.dk, keys.vaultId, blob);
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
