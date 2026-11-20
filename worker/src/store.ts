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

/** All objects under a prefix, ascending by key. Only used for small prefixes and the backup. */
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
export interface Credential { publicKey: string; transports: string[]; createdAt: string; prfSalt: string; wrappedDk: string }
export interface Recovery { salt: string; authVerifier: string; wrappedDk: string; createdAt: string }

export const recoveryKey = (version: number): string => `recovery/${String(version).padStart(6, '0')}`;

/** The highest recovery version, or null before the vault is claimed. */
export async function currentRecovery(bucket: R2Bucket): Promise<{ version: number; record: Recovery } | null> {
  const last = (await listAll(bucket, 'recovery/')).at(-1);
  if (!last) return null;
  const record = await getJson<Recovery>(bucket, last.key);
  return record ? { version: Number(last.key.slice('recovery/'.length)), record } : null;
}

/** Prefixes worth backing up (`used/` challenge markers are not). */
const BACKUP_PREFIXES = ['meta/', 'cred/', 'recovery/', 'e/'];
/** Keeps one cron run well inside the per-invocation subrequest limit; the rest is copied the next day. */
export const BACKUP_MAX_COPIES = 300;

/** Copies objects missing from BACKUP (only-if-new). Returns how many were copied. */
export async function backup(env: Env): Promise<number> {
  let copied = 0;
  for (const prefix of BACKUP_PREFIXES) {
    const have = new Set((await listAll(env.BACKUP, prefix)).map((o) => o.key));
    for (const { key } of await listAll(env.DATA, prefix)) {
      if (have.has(key)) continue;
      if (copied >= BACKUP_MAX_COPIES) return copied;
      const o = await env.DATA.get(key);
      if (!o) continue;
      if ((await env.BACKUP.put(key, await o.arrayBuffer(), ONLY_IF_NEW)) !== null) copied++;
    }
  }
  return copied;
}
