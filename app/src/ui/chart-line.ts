import type { PricePoint } from '../data/price-history.ts';

/** A point as drawn: time (ms) and price (cents), possibly an average of several days. */
export interface DrawnPoint {
  ms: number;
  cents: number;
}

/** Index of the highest price (the first, if it repeats), or -1 for no points. */
export function peakIndex(points: readonly PricePoint[]): number {
  let best = -1;
  points.forEach((p, i) => {
    if (best < 0 || p.cents > (points[best] as PricePoint).cents) best = i;
  });
  return best;
}

/**
 * The line to draw: at most about `buckets` points, each the average of a run of neighbouring days, so a phone-width
 * chart reads as a smooth line rather than day-to-day noise. The first and last points are kept as they are, and so
 * is `keep` (the high the chart marks), so smoothing never hides the peak. Few points are drawn as they are.
 */
export function smoothLine(points: readonly PricePoint[], buckets: number, keep = -1): DrawnPoint[] {
  const n = points.length;
  if (n <= Math.max(3, Math.floor(buckets * 1.5))) return points.map((p) => ({ ms: p.ms, cents: p.cents }));
  const inner = Math.max(1, buckets - 2);
  const out: DrawnPoint[] = [{ ms: (points[0] as PricePoint).ms, cents: (points[0] as PricePoint).cents }];
  for (let b = 0; b < inner; b++) {
    const from = 1 + Math.floor(((n - 2) * b) / inner);
    const to = 1 + Math.floor(((n - 2) * (b + 1)) / inner);
    if (to <= from) continue;
    if (keep >= from && keep < to) {
      // The kept point stands alone, with the days either side of it averaged as usual.
      if (keep > from) out.push(average(points, from, keep));
      out.push({ ms: (points[keep] as PricePoint).ms, cents: (points[keep] as PricePoint).cents });
      if (keep + 1 < to) out.push(average(points, keep + 1, to));
    } else out.push(average(points, from, to));
  }
  out.push({ ms: (points[n - 1] as PricePoint).ms, cents: (points[n - 1] as PricePoint).cents });
  return out;
}

function average(points: readonly PricePoint[], from: number, to: number): DrawnPoint {
  let ms = 0;
  let cents = 0;
  for (let i = from; i < to; i++) {
    ms += (points[i] as PricePoint).ms;
    cents += (points[i] as PricePoint).cents;
  }
  // Only for drawing: the line's height, never a figure shown or saved.
  return { ms: ms / (to - from), cents: cents / (to - from) };
}

/** The drawn line's price at time `ms` (straight between drawn points), so the scrub dot sits on the line. */
export function lineCentsAt(line: readonly DrawnPoint[], ms: number): number {
  const first = line[0];
  if (first === undefined) return 0;
  if (ms <= first.ms) return first.cents;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as DrawnPoint;
    const b = line[i] as DrawnPoint;
    if (ms <= b.ms) return b.ms === a.ms ? b.cents : a.cents + ((b.cents - a.cents) * (ms - a.ms)) / (b.ms - a.ms);
  }
  return (line[line.length - 1] as DrawnPoint).cents;
}

/**
 * Rows for the screen-reader table: every point when there are few, else the first point of each month, the high
 * and the last point, so a daily series is a readable table rather than a thousand rows.
 */
export function tableIndexes(points: readonly PricePoint[], peak: number): number[] {
  if (points.length <= 60) return points.map((_, i) => i);
  const keep = new Set<number>([0, points.length - 1]);
  if (peak >= 0) keep.add(peak);
  let month = '';
  points.forEach((p, i) => {
    const m = new Date(p.ms).toISOString().slice(0, 7);
    if (m !== month) keep.add(i);
    month = m;
  });
  return [...keep].sort((a, b) => a - b);
}
