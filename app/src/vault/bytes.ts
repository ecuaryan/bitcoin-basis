/**
 * Tiny byte helpers: random bytes, UTF-8, base64url, hex. No dependencies.
 *
 * `Bytes` is a `Uint8Array` backed by a plain `ArrayBuffer`, which is what WebCrypto's
 * `BufferSource` parameters accept.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

/** `n` bytes from `crypto.getRandomValues`. */
export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** A fresh copy of any buffer or view, as `Bytes`. */
export function toBytes(data: ArrayBuffer | ArrayBufferView): Bytes {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(view.length);
  out.set(view);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(text: string): Bytes {
  return encoder.encode(text);
}

/** Strict UTF-8 decode (throws on invalid sequences). */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function concatBytes(...parts: readonly Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Overwrite with zeros (best effort: the engine may hold other copies). */
export function wipe(bytes: Uint8Array | null | undefined): void {
  bytes?.fill(0);
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const sym = (n: number): string => B64URL.charAt(n);
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64URL.charCodeAt(i)] = i;
  t['+'.charCodeAt(0)] = 62;
  t['/'.charCodeAt(0)] = 63;
  return t;
})();

/** Unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += sym(n >>> 18) + sym((n >>> 12) & 63) + sym((n >>> 6) & 63) + sym(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += sym(n >>> 18) + sym((n >>> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += sym(n >>> 18) + sym((n >>> 12) & 63) + sym((n >>> 6) & 63);
  }
  return out;
}

/** Standard (padded) base64. */
export function toBase64(bytes: Uint8Array): string {
  const s = toBase64Url(bytes).replace(/-/g, '+').replace(/_/g, '/');
  return s + '='.repeat((4 - (s.length % 4)) % 4);
}

/**
 * Decodes base64url or standard base64, padded or not. Throws `TypeError` on anything else
 * (bad characters, impossible length, non-zero trailing bits).
 */
export function fromBase64Url(text: string): Bytes {
  const s = text.endsWith('==') ? text.slice(0, -2) : text.endsWith('=') ? text.slice(0, -1) : text;
  if (s.length % 4 === 1) throw new TypeError('invalid base64 length');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? (B64_LOOKUP[c] as number) : -1;
    if (v < 0) throw new TypeError('invalid base64 character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >>> bits) & 0xff;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) throw new TypeError('invalid base64 trailing bits');
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Bytes {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new TypeError('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
