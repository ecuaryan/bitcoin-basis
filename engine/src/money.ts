/** Integer money helpers. BTC is whole sats, dollars are whole cents. */

export type Sats = number;
export type Cents = number;

export const SATS_PER_BTC = 100_000_000;

function assertSafeInt(name: string, v: number): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${name} must be a safe integer, got ${v}`);
}

/** Round a BigInt fraction n/d half away from zero (half-up for positives). */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (2n * d);
  return neg ? -q : q;
}

/** round_half_up(a * b / c) using exact BigInt intermediates. Inputs and result are safe integers. */
export function mulDivRoundHalfUp(a: number, b: number, c: number): number {
  assertSafeInt('a', a); assertSafeInt('b', b); assertSafeInt('c', c);
  const r = divRoundHalfUp(BigInt(a) * BigInt(b), BigInt(c));
  const out = Number(r);
  assertSafeInt('result', out);
  return out;
}

/**
 * Split `total` across `weights` proportionally, half-up, with the remainder on the last piece,
 * so the pieces always add back to `total` exactly.
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
