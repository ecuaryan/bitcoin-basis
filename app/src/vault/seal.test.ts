import { describe, expect, test } from 'vitest';
import { randomBytes, utf8 } from './bytes.ts';
import { importDataKey } from './keys.ts';
import { BLOB_OVERHEAD, blobEpoch, BUCKETS, isValidBlobSize, openBlob, packEntries, pad, SealError, sealEntries, sealPadded, unpad } from './seal.ts';

const VAULT = 'vault-A';
const key = () => importDataKey(randomBytes(32));
const filler = (bytes: number) => ({ id: 'x', note: 'n'.repeat(bytes) });

describe('padding', () => {
  test('0x80 then zeros up to the smallest bucket that fits', () => {
    expect(pad(new Uint8Array(0)).length).toBe(1024);
    expect(pad(new Uint8Array(1023)).length).toBe(1024);
    expect(pad(new Uint8Array(1024)).length).toBe(4096);
    expect(pad(new Uint8Array(4095)).length).toBe(4096);
    expect(pad(new Uint8Array(16383)).length).toBe(16384);
    expect(pad(new Uint8Array(65535)).length).toBe(65536);
    expect(() => pad(new Uint8Array(65536))).toThrow(SealError);
    const p = pad(utf8('abc'));
    expect([...p.slice(0, 5)]).toEqual([97, 98, 99, 0x80, 0]);
    expect(p.slice(4).every((b) => b === 0)).toBe(true);
    expect(new TextDecoder().decode(unpad(p))).toBe('abc');
  });

  test('unpad rejects bad padding and non-bucket sizes', () => {
    expect(() => unpad(new Uint8Array(1024))).toThrow(SealError);
    const p = pad(utf8('abc'));
    p[1023] = 1;
    expect(() => unpad(p)).toThrow(SealError);
    expect(() => unpad(new Uint8Array(1000))).toThrow(SealError);
  });

  test('ciphertext length reveals only the bucket', async () => {
    const dk = await key();
    const sizes = new Set<number>();
    for (const n of [0, 10, 500, 900]) {
      for (const s of await sealEntries(dk, VAULT, 1, [filler(n)])) sizes.add(s.blob.length);
    }
    expect([...sizes]).toEqual([1024 + BLOB_OVERHEAD]);
    for (const b of BUCKETS) expect(isValidBlobSize(b + 33)).toBe(true);
    expect(isValidBlobSize(1024 + 29)).toBe(false);
    expect(isValidBlobSize(2000)).toBe(false);
  });
});

describe('seal and open', () => {
  test('round trip; wire format is version || epoch || iv || ciphertext', async () => {
    const dk = await key();
    const entries = [{ id: 'a', n: 1 }, { id: 'b', text: 'héllo ₿' }];
    const sealed = await sealEntries(dk, VAULT, 1, entries);
    expect(sealed).toHaveLength(1);
    const blob = (sealed[0] as (typeof sealed)[number]).blob;
    expect(blob[0]).toBe(2);
    expect([...blob.slice(1, 5)]).toEqual([0, 0, 0, 1]);
    expect(blobEpoch(blob)).toBe(1);
    expect(await openBlob(dk, VAULT, blob)).toEqual(entries);
    const [later] = await sealEntries(dk, VAULT, 70000, entries);
    expect(blobEpoch((later as NonNullable<typeof later>).blob)).toBe(70000);
    // Fresh IV each time.
    const again = await sealEntries(dk, VAULT, 1, entries);
    expect(Buffer.from((again[0] as (typeof again)[number]).blob).equals(Buffer.from(blob))).toBe(false);
  });

  test('large batches are split, in order, and reassemble exactly', async () => {
    const dk = await key();
    const entries = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, note: 'z'.repeat(5000) }));
    const sealed = await sealEntries(dk, VAULT, 1, entries);
    expect(sealed.length).toBeGreaterThan(1);
    for (const s of sealed) expect(isValidBlobSize(s.blob.length)).toBe(true);
    const opened = [];
    for (const s of sealed) opened.push(...(await openBlob(dk, VAULT, s.blob)));
    expect(opened).toEqual(entries);
    expect(sealed.flatMap((s) => s.entries)).toEqual(entries);
  });

  test('packing fills the largest bucket before starting another', () => {
    const batches = packEntries(Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, note: 'z'.repeat(3000) })));
    expect(batches.map((b) => b.padded.length)).toEqual([65536, 65536]);
  });

  test('one entry too large for any blob is refused', async () => {
    await expect(sealEntries(await key(), VAULT, 1, [filler(70_000)])).rejects.toMatchObject({ code: 'too-large' });
  });

  test('wrong vault id, wrong key, tampering and malformed blobs fail', async () => {
    const dk = await key();
    const [s] = await sealEntries(dk, VAULT, 1, [{ id: 'a' }]);
    const blob = (s as NonNullable<typeof s>).blob;
    await expect(openBlob(dk, 'vault-B', blob)).rejects.toMatchObject({ code: 'decrypt-failed' });
    await expect(openBlob(await key(), VAULT, blob)).rejects.toMatchObject({ code: 'decrypt-failed' });
    const t = blob.slice();
    t[100] = (t[100] ?? 0) ^ 1;
    await expect(openBlob(dk, VAULT, t)).rejects.toMatchObject({ code: 'decrypt-failed' });
    const v = blob.slice();
    v[0] = 1;
    await expect(openBlob(dk, VAULT, v)).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(blobEpoch(v)).toBeNull();
    // The epoch is authenticated: relabelling a blob with another epoch breaks it.
    const relabelled = blob.slice();
    relabelled[4] = 2;
    await expect(openBlob(dk, VAULT, relabelled)).rejects.toMatchObject({ code: 'decrypt-failed' });
    const zero = blob.slice();
    zero[4] = 0;
    expect(blobEpoch(zero)).toBeNull();
    await expect(openBlob(dk, VAULT, zero)).rejects.toMatchObject({ code: 'malformed' });
    await expect(openBlob(dk, VAULT, blob.slice(0, -1))).rejects.toMatchObject({ code: 'bad-size' });
    // Valid encryption of a payload with the wrong shape.
    const bad = await sealPadded(dk, VAULT, 1, pad(utf8('{"v":2,"entries":[]}')));
    await expect(openBlob(dk, VAULT, bad)).rejects.toMatchObject({ code: 'malformed' });
    const notJson = await sealPadded(dk, VAULT, 1, pad(utf8('nope')));
    await expect(openBlob(dk, VAULT, notJson)).rejects.toMatchObject({ code: 'malformed' });
  });
});
