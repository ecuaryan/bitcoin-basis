/** Integer money helpers. BTC is whole sats, dollars are whole cents. */

export type Sats = number;
export type Cents = number;

export const SATS_PER_BTC = 100_000_000;

/** Largest amount one entry may carry: 21,000,000 BTC. */
export const MAX_ENTRY_SATS = 21_000_000 * SATS_PER_BTC;
/** Largest dollar amount one entry may carry: $1 trillion. */
export const MAX_ENTRY_CENTS = 100_000_000_000_000;
/**
 * Cap on the ledger's running totals (all sats acquired; all cents of cost, value and proceeds entered).
 * 2^52 leaves headroom so any sum of ledger figures plus a few entry-sized amounts stays a safe integer.
 */
export const MAX_LEDGER_TOTAL = 2 ** 52;

function assertSafeInt(name: string, v: number): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${name} must be a safe integer, got ${v}`);
}

/**
 * Round a BigInt fraction n/d to the nearest integer, halves away from zero (symmetric:
 * 0.5 → 1, −0.5 → −1). The name says half-up because that is what it does for positives.
 */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (2n * d);
  return neg ? -q : q;
}

/** round(a * b / c) (halves away from zero) with exact BigInt intermediates, or null if the result is not a safe integer. */
export function mulDivOrNull(a: number, b: number, c: number): number | null {
  assertSafeInt('a', a); assertSafeInt('b', b); assertSafeInt('c', c);
  const out = Number(divRoundHalfUp(BigInt(a) * BigInt(b), BigInt(c)));
  return Number.isSafeInteger(out) ? out : null;
}

/** round(a * b / c) (halves away from zero) using exact BigInt intermediates. Inputs and result are safe integers. */
export function mulDivRoundHalfUp(a: number, b: number, c: number): number {
  const out = mulDivOrNull(a, b, c);
  if (out === null) throw new RangeError('result must be a safe integer');
  return out;
}

/**
 * Split `total` across `weights` proportionally (halves away from zero), with the remainder on the
 * last piece, so the pieces always add back to `total` exactly.
 */
export function splitProportional(total: number, weights: readonly number[]): number[] {
  assertSafeInt('total', total);
  const sum = weights.reduce((s, w) => { assertSafeInt('weight', w); return s + w; }, 0);
  if (weights.length === 0) return [];
  if (sum === 0) throw new RangeError('weights sum to zero');
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < weights.length - 1; i++) {
    const piece = mulDivRoundHalfUp(total, weights[i] as number, sum);
    out.push(piece);
    used += piece;
  }
  out.push(total - used);
  return out;
}
