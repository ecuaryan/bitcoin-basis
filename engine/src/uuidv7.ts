/**
 * UUIDv7 (RFC 9562): 48-bit Unix milliseconds, then a 12-bit counter (method 1), then random bits.
 * Ids from one generator always compare (as strings) in creation order, even within one millisecond
 * or if the clock steps backwards.
 */

export interface UuidV7Options {
  /** Milliseconds since the epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Fills the array with random bytes. Defaults to `crypto.getRandomValues`. */
  readonly random?: (bytes: Uint8Array) => void;
}

/** Web Crypto (Node 24 and browsers); declared here because the engine compiles without DOM or Node types. */
declare const crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };

const MAX_MS = 2 ** 48 - 1;
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A UUIDv7 generator with its own monotonic state. Inject `now` and `random` in tests. */
export function createUuidV7(options: UuidV7Options = {}): () => string {
  const now = options.now ?? Date.now;
  const random = options.random ?? ((bytes: Uint8Array) => void crypto.getRandomValues(bytes));
  let lastMs = -1;
  let counter = 0;

  return () => {
    const bytes = new Uint8Array(10);
    random(bytes);
    const view = new DataView(bytes.buffer);
    const seed = view.getUint16(0) & 0x7ff; // leaves room for the counter to grow within one ms
    let ms = now();
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_MS) throw new RangeError(`clock returned ${ms}`);
    if (ms > lastMs) {
      counter = seed;
    } else {
      ms = lastMs;
      counter += 1;
      if (counter > 0xfff) {
        ms += 1;
        counter = seed;
      }
    }
    lastMs = ms;
    const ts = ms.toString(16).padStart(12, '0');
    const version = (0x7000 | counter).toString(16);
    const variant = (0x8000 | (view.getUint16(2) & 0x3fff)).toString(16);
    const tail = Array.from(bytes.subarray(4), (b) => b.toString(16).padStart(2, '0')).join('');
    return `${ts.slice(0, 8)}-${ts.slice(8)}-${version}-${variant}-${tail}`;
  };
}

/** Default generator using the system clock and `crypto.getRandomValues`. */
export const uuidv7: () => string = createUuidV7();

/** True for a lowercase UUIDv7 string. */
export function isUuidV7(s: string): boolean {
  return UUID_V7_RE.test(s);
}
