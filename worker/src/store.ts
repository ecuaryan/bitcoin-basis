// R2 access. The only write is `putNew` (only-if-new); there is no delete or overwrite anywhere.
import { HttpError } from './http.ts';

export interface Env {
  DATA: R2Bucket;
  BACKUP: R2Bucket;
  ORIGIN: string;
  RP_ID: string;
  RP_NAME: string;
  SESSION_SECRET: string;
  SETUP_CODE?: string;
  /** "1" allows an http:// ORIGIN. Set only in worker/.dev.vars for `wrangler dev`, never in wrangler.jsonc. */
  DEV_ALLOW_HTTP?: string;
  /** Workers Rate Limiting binding for the sign-in and registration endpoints. */
  AUTH_LIMITER?: RateLimit;
}

export const ONLY_IF_NEW: R2PutOptions = { onlyIf: { etagDoesNotMatch: '*' } };

/** Writes a new object; throws 409 if the key already exists. */
export async function putNew(bucket: R2Bucket, key: string, body: string | Uint8Array): Promise<void> {
  if ((await bucket.put(key, body, ONLY_IF_NEW)) === null) throw new HttpError(409);
}

export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const o = await bucket.get(key);
  return o ? ((await o.json()) as T) : null;
}

/** All objects under a prefix, ascending by key. Only used for small prefixes. */
export async function listAll(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return out;
}

export interface Claimed { vaultId: string; claimedAt: string }
/** The ECDH key a passkey receives data keys with. `wrappedPrivateKey` is sealed under that passkey's PRF KEK. */
export interface CredentialKey { publicKey: string; wrappedPrivateKey: string; epoch: number; binding: string }
export interface Credential { publicKey: string; transports: string[]; createdAt: string; prfSalt: string; credentialKey: CredentialKey }
export interface Recovery { salt: string; authVerifier: string; wrappedDk: string; createdAt: string }
/** `binding` (rotations only): the credential re-bound under this epoch's data key by the rotating device. */
export interface Delivery { ephemeralPublicKey: string; wrappedDk: string; binding?: string; createdAt: string }

const six = (n: number) => String(n).padStart(6, '0');
export const recoveryKey = (version: number): string => `recovery/${six(version)}`;
export const historyKey = (epoch: number): string => `epoch/${six(epoch)}/history`;
export const deliveryKey = (epoch: number, credId: string): string => `epoch/${six(epoch)}/cred/${credId}`;
export const revokedKey = (sid: string): string => `revoked/${sid}`;

/** The highest recovery version (= the current data-key epoch), or null before the vault is claimed. */
export async function currentRecovery(bucket: R2Bucket): Promise<{ version: number; record: Recovery } | null> {
  const last = (await listAll(bucket, 'recovery/')).at(-1);
  if (!last) return null;
  const record = await getJson<Recovery>(bucket, last.key);
  return record ? { version: Number(last.key.slice('recovery/'.length)), record } : null;
}

export async function currentEpoch(bucket: R2Bucket): Promise<number> {
  const last = (await listAll(bucket, 'recovery/')).at(-1);
  return last ? Number(last.key.slice('recovery/'.length)) : 0;
}

/** Epoch `e`'s history (the data keys of epochs 1..e-1 sealed under DK_e); null for epoch 1. */
export async function history(bucket: R2Bucket, epoch: number): Promise<string | null> {
  if (epoch <= 1) return null;
  const o = await bucket.get(historyKey(epoch));
  return o ? o.text() : null;
}

/** The newest data-key delivery for a credential, searching down from `from`. */
export async function newestDelivery(bucket: R2Bucket, credId: string, from: number): Promise<{ epoch: number; delivery: Delivery } | null> {
  for (let e = from; e >= 1; e--) {
    const d = await getJson<Delivery>(bucket, deliveryKey(e, credId));
    if (d) return { epoch: e, delivery: d };
  }
  return null;
}

// ---- backup -------------------------------------------------------------------------------------

/** Small prefixes, compared in full on every run. */
const SMALL_PREFIXES = ['meta/', 'cred/', 'recovery/', 'epoch/'];
/** Keeps one cron run well inside the per-invocation subrequest limit; the rest is copied the next run. */
export const BACKUP_MAX_COPIES = 300;
/** At most this many `e/` listing pages per run. */
export const BACKUP_MAX_PAGES = 5;
/** Progress markers (in DATA, newest first): which `e/` key the backup has reached. Not backed up. */
export const PROGRESS_PREFIX = 'backup-progress/';
const OVERLAP_MS = 10 * 60 * 1000;
const MAX_MS = 9_999_999_999_999;

/**
 * Copies objects missing from BACKUP (only-if-new). Returns how many were copied.
 * `e/` is not re-listed from the start: each run writes an append-only progress marker
 * (`backup-progress/<inverted ms>`, so the newest lists first) with the last `e/` key it reached,
 * and the next run lists from ten minutes before it (uploads are stamped when they start).
 */
export async function backup(env: Env, now = Date.now()): Promise<number> {
  let copied = 0;
  const copy = async (key: string): Promise<boolean> => {
    const o = await env.DATA.get(key);
    if (!o) return false;
    if ((await env.BACKUP.put(key, await o.arrayBuffer(), ONLY_IF_NEW)) !== null) copied++;
    return true;
  };
  for (const prefix of SMALL_PREFIXES) {
    const have = new Set((await listAll(env.BACKUP, prefix)).map((o) => o.key));
    for (const { key } of await listAll(env.DATA, prefix)) {
      if (have.has(key)) continue;
      if (copied >= BACKUP_MAX_COPIES) return copied;
      await copy(key);
    }
  }

  const marker = (await env.DATA.list({ prefix: PROGRESS_PREFIX, limit: 1 })).objects[0];
  const reached = marker ? ((await getJson<{ last: string }>(env.DATA, marker.key))?.last ?? null) : null;
  const ms = reached === null ? null : /^e\/(\d{13})/.exec(reached)?.[1];
  const startAfter = ms ? `e/${String(Math.max(0, Number(ms) - OVERLAP_MS)).padStart(13, '0')}` : undefined;
  let last = reached;
  let cursor: string | undefined;
  for (let page = 0; page < BACKUP_MAX_PAGES; page++) {
    const listing = await env.DATA.list({ prefix: 'e/', limit: 1000, ...(cursor ? { cursor } : startAfter ? { startAfter } : {}) });
    for (const { key } of listing.objects) {
      // Inside the overlap only copy what BACKUP lacks; past the marker every key is new.
      if (reached !== null && key <= reached && (await env.BACKUP.head(key)) !== null) continue;
      if (copied >= BACKUP_MAX_COPIES) return finish();
      await copy(key);
      if (last === null || key > last) last = key;
    }
    if (!listing.truncated) break;
    cursor = listing.cursor;
  }
  return finish();

  async function finish(): Promise<number> {
    if (last !== null && last !== reached) {
      const key = `${PROGRESS_PREFIX}${String(MAX_MS - now).padStart(13, '0')}-${crypto.randomUUID()}`;
      await env.DATA.put(key, JSON.stringify({ last }), ONLY_IF_NEW);
    }
    return copied;
  }
}
