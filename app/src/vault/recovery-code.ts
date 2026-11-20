/**
 * The recovery code: 128 random bits plus a 22-bit check (the first 22 bits of SHA-256 of the
 * secret), written as 30 Crockford base32 characters in six dash-separated groups of five.
 *
 * This is NOT a Bitcoin seed phrase. It unlocks this app's encrypted records and nothing else.
 * See docs/sync-protocol.md, "Recovery code".
 */
import { randomBytes, type Bytes } from './bytes.ts';

/** Crockford base32: no I, L, O or U, so no two symbols look alike. */
export const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_SECRET_BYTES = 16;
const CHECK_BITS = 22n;
const CHARS = 30;
const GROUP = 5;

/** A checked recovery code. `text` is the canonical `XXXXX-XXXXX-…` form. */
export interface RecoveryCode {
  readonly secret: Bytes;
  readonly text: string;
}

export type RecoveryCodeProblem = 'empty' | 'invalid-character' | 'too-short' | 'too-long' | 'checksum';

/** Thrown by `parseRecoveryCode`. Every problem is detected locally, before any network call. */
export class RecoveryCodeError extends Error {
  override readonly name = 'RecoveryCodeError';
  constructor(
    readonly problem: RecoveryCodeProblem,
    /** For `invalid-character`: the character and its 0-based index among the code's characters. */
    readonly detail: { readonly character?: string; readonly position?: number; readonly length?: number } = {},
  ) {
    super(MESSAGES[problem]);
  }
}

const MESSAGES: Record<RecoveryCodeProblem, string> = {
  empty: 'Enter your recovery code.',
  'invalid-character': 'The recovery code has a character that is not in it. Check for typos.',
  'too-short': 'The recovery code is too short. It has 30 characters.',
  'too-long': 'The recovery code is too long. It has 30 characters.',
  checksum: 'That recovery code has a typo. Check each group of five.',
};

/** A new random recovery code. */
export function generateRecoveryCode(): Promise<RecoveryCode> {
  return recoveryCodeFromSecret(randomBytes(RECOVERY_SECRET_BYTES));
}

/** The code for a given 16-byte secret (used by `generateRecoveryCode` and by tests). */
export async function recoveryCodeFromSecret(secret: Uint8Array): Promise<RecoveryCode> {
  if (secret.length !== RECOVERY_SECRET_BYTES) throw new RangeError('recovery secret must be 16 bytes');
  const copy: Bytes = new Uint8Array(secret);
  const value = (bytesToBigInt(copy) << CHECK_BITS) | (await checkOf(copy));
  let chars = '';
  for (let i = CHARS - 1; i >= 0; i--) chars += RECOVERY_ALPHABET[Number((value >> BigInt(i * 5)) & 31n)];
  return { secret: copy, text: formatRecoveryCode(chars) };
}

/** Group 30 characters as `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`. */
export function formatRecoveryCode(chars: string): string {
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += GROUP) groups.push(chars.slice(i, i + GROUP));
  return groups.join('-');
}

/**
 * Normalize typed input without checking it: upper-case, drop spaces, dashes and other
 * separators, read `O` as `0` and `I`/`L` as `1`. Accepts a pasted `#recover=` link.
 * Synchronous, for live feedback while typing.
 */
export function cleanRecoveryCodeInput(input: string): { chars: string; problem: RecoveryCodeProblem | null; detail: RecoveryCodeError['detail'] } {
  const hashAt = input.indexOf('#');
  const fromLink = hashAt >= 0 ? readRecoveryFragment(input.slice(hashAt)) : null;
  const raw = fromLink ?? input;
  const chars = raw
    .toUpperCase()
    .replace(/[\s\-‐-―_.·]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (chars.length === 0) return { chars, problem: 'empty', detail: {} };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    if (!RECOVERY_ALPHABET.includes(c)) return { chars, problem: 'invalid-character', detail: { character: c, position: i } };
  }
  if (chars.length < CHARS) return { chars, problem: 'too-short', detail: { length: chars.length } };
  if (chars.length > CHARS) return { chars, problem: 'too-long', detail: { length: chars.length } };
  return { chars, problem: null, detail: {} };
}

/** Parse forgiving input and verify the check bits. Throws `RecoveryCodeError`. */
export async function parseRecoveryCode(input: string): Promise<RecoveryCode> {
  const { chars, problem, detail } = cleanRecoveryCodeInput(input);
  if (problem !== null) throw new RecoveryCodeError(problem, detail);
  let value = 0n;
  for (const c of chars) value = (value << 5n) | BigInt(RECOVERY_ALPHABET.indexOf(c));
  const secret = bigIntToBytes(value >> CHECK_BITS, RECOVERY_SECRET_BYTES);
  if ((value & ((1n << CHECK_BITS) - 1n)) !== (await checkOf(secret))) throw new RecoveryCodeError('checksum');
  return { secret, text: formatRecoveryCode(chars) };
}

/** `https://<app>/#recover=<code>`, for the emergency kit's QR code. */
export function recoveryLink(appUrl: string, code: RecoveryCode | string): string {
  const url = new URL(appUrl);
  url.hash = `recover=${typeof code === 'string' ? code : code.text}`;
  return url.toString();
}

/** The code text in a `#recover=` fragment (or `null`). Does not validate it. */
export function readRecoveryFragment(hash: string): string | null {
  const m = /^#?recover=([^&]*)/.exec(hash);
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1] as string);
  } catch {
    return m[1] as string;
  }
}

/**
 * Read a `#recover=` code from the address bar and immediately remove it from the URL and the
 * history entry (`history.replaceState`). Returns the unvalidated text, or `null`.
 */
export function takeRecoveryCodeFromUrl(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = window.history,
): string | null {
  const code = readRecoveryFragment(loc.hash);
  if (code === null) return null;
  hist.replaceState(hist.state, '', loc.pathname + loc.search);
  return code;
}

async function checkOf(secret: Bytes): Promise<bigint> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
  return BigInt((((h[0] as number) << 14) | ((h[1] as number) << 6) | ((h[2] as number) >> 2)) >>> 0);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bigIntToBytes(value: bigint, length: number): Bytes {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
