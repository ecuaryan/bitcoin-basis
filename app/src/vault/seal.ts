/**
 * Sealed blobs: the only thing that leaves the device.
 *
 * Plaintext = UTF-8 JSON `{"v":1,"entries":[…]}`, then `0x80`, then zeros up to the smallest bucket
 * (1, 4, 16 or 64 KiB) that fits. Wire format = `version (1) || iv (12) || AES-GCM ciphertext+tag`,
 * AAD = `bitcoin-basis/blob/v1|<vaultId>`. A blob's length reveals only its bucket.
 * See docs/sync-protocol.md, "Padding".
 */
import { concatBytes, fromUtf8, randomBytes, utf8, type Bytes } from './bytes.ts';

export const BLOB_VERSION = 1;
export const PAYLOAD_VERSION = 1;
/** Padded plaintext sizes, smallest first. */
export const BUCKETS = [1024, 4096, 16384, 65536] as const;
export const MAX_BUCKET = 65536;
/** version byte + IV + GCM tag. */
export const BLOB_OVERHEAD = 1 + 12 + 16;
export const BLOB_AAD_PREFIX = 'bitcoin-basis/blob/v1';

export type SealErrorCode = 'too-large' | 'bad-size' | 'unsupported-version' | 'decrypt-failed' | 'malformed';

export class SealError extends Error {
  override readonly name = 'SealError';
  constructor(readonly code: SealErrorCode, message?: string) {
    super(message ?? `sealed blob: ${code}`);
  }
}

/** The exact blob size for a bucket. */
export function blobSizeForBucket(bucket: number): number {
  return bucket + BLOB_OVERHEAD;
}

/** True when `size` is one of the four allowed blob sizes (what the server checks). */
export function isValidBlobSize(size: number): boolean {
  return BUCKETS.some((b) => blobSizeForBucket(b) === size);
}

export function blobAad(vaultId: string): Bytes {
  if (vaultId.length === 0 || vaultId.includes('|')) throw new SealError('malformed', 'bad vault id');
  return utf8(`${BLOB_AAD_PREFIX}|${vaultId}`);
}

/** Append `0x80` and zeros up to the smallest bucket that fits. Throws `too-large` past 64 KiB. */
export function pad(plain: Uint8Array): Bytes {
  const bucket = BUCKETS.find((b) => plain.length + 1 <= b);
  if (bucket === undefined) throw new SealError('too-large');
  const out = new Uint8Array(bucket);
  out.set(plain);
  out[plain.length] = 0x80;
  return out;
}

/** Strip the padding. Throws `malformed` unless the input is a full bucket ending in `0x80 0…0`. */
export function unpad(padded: Uint8Array): Bytes {
  if (!BUCKETS.some((b) => b === padded.length)) throw new SealError('malformed', 'padded size is not a bucket');
  let i = padded.length - 1;
  while (i >= 0 && padded[i] === 0) i--;
  if (i < 0 || padded[i] !== 0x80) throw new SealError('malformed', 'bad padding');
  return padded.slice(0, i);
}

/** One blob's worth of entries, as JSON text. */
export interface PackedBatch<T> {
  readonly entries: readonly T[];
  readonly padded: Bytes;
}

const HEAD = utf8(`{"v":${PAYLOAD_VERSION},"entries":[`).length;
const TAIL = utf8(']}').length;

/**
 * Split entries, in order, into as few blobs as fit in the largest bucket, each padded to its own
 * smallest bucket. Throws `too-large` if one entry alone cannot fit.
 */
export function packEntries<T>(entries: readonly T[]): PackedBatch<T>[] {
  const batches: PackedBatch<T>[] = [];
  let group: T[] = [];
  let texts: string[] = [];
  let size = HEAD + TAIL + 1;
  const flush = () => {
    if (group.length === 0) return;
    batches.push({ entries: group, padded: pad(utf8(`{"v":${PAYLOAD_VERSION},"entries":[${texts.join(',')}]}`)) });
    group = [];
    texts = [];
    size = HEAD + TAIL + 1;
  };
  for (const e of entries) {
    const text = JSON.stringify(e);
    if (typeof text !== 'string') throw new SealError('malformed', 'entry is not JSON');
    const n = utf8(text).length;
    if (HEAD + TAIL + 1 + n > MAX_BUCKET) throw new SealError('too-large', 'one entry is larger than a blob');
    const add = n + (group.length > 0 ? 1 : 0);
    if (size + add > MAX_BUCKET) flush();
    size += n + (group.length > 0 ? 1 : 0);
    group.push(e);
    texts.push(text);
  }
  flush();
  return batches;
}

/** Encrypt one padded payload. `iv` is injectable for test vectors only. */
export async function sealPadded(dk: CryptoKey, vaultId: string, padded: Bytes, iv: Bytes = randomBytes(12)): Promise<Bytes> {
  if (!BUCKETS.some((b) => b === padded.length)) throw new SealError('malformed', 'payload is not padded to a bucket');
  if (iv.length !== 12) throw new SealError('malformed', 'IV must be 12 bytes');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: blobAad(vaultId) }, dk, padded);
  return concatBytes(Uint8Array.of(BLOB_VERSION), iv, new Uint8Array(ct));
}

/** Pack and seal entries; returns one sealed blob per batch, with the entries it holds. */
export async function sealEntries<T>(dk: CryptoKey, vaultId: string, entries: readonly T[]): Promise<{ entries: readonly T[]; blob: Bytes }[]> {
  const out: { entries: readonly T[]; blob: Bytes }[] = [];
  for (const batch of packEntries(entries)) out.push({ entries: batch.entries, blob: await sealPadded(dk, vaultId, batch.padded) });
  return out;
}

/** Decrypt and check a blob; returns its raw (not yet validated) entries. Throws `SealError`. */
export async function openBlob(dk: CryptoKey, vaultId: string, blob: Uint8Array): Promise<unknown[]> {
  if (!isValidBlobSize(blob.length)) throw new SealError('bad-size');
  if (blob[0] !== BLOB_VERSION) throw new SealError('unsupported-version');
  let padded: Bytes;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(1, 13), additionalData: blobAad(vaultId) }, dk, blob.slice(13));
    padded = new Uint8Array(pt);
  } catch {
    throw new SealError('decrypt-failed');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(fromUtf8(unpad(padded)));
  } catch (e) {
    if (e instanceof SealError) throw e;
    throw new SealError('malformed', 'payload is not UTF-8 JSON');
  } finally {
    padded.fill(0);
  }
  if (typeof payload !== 'object' || payload === null || (payload as { v?: unknown }).v !== PAYLOAD_VERSION || !Array.isArray((payload as { entries?: unknown }).entries)) {
    throw new SealError('malformed', 'payload shape');
  }
  return (payload as { entries: unknown[] }).entries;
}
