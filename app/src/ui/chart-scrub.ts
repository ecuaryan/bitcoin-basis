import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { PricePoint } from '../data/price-history.ts';
import { formatMoney, maskDigits } from '../lib/format.ts';

/** Index of the point nearest to `fraction` (0 = left edge, 1 = right edge) of the time axis. */
export function nearestIndex(points: readonly PricePoint[], fraction: number): number {
  if (points.length === 0) return 0;
  const first = (points[0] as PricePoint).ms;
  const last = (points[points.length - 1] as PricePoint).ms;
  const target = first + Math.min(1, Math.max(0, fraction)) * (last - first);
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid] as PricePoint).ms <= target) lo = mid;
    else hi = mid;
  }
  return Math.abs((points[lo] as PricePoint).ms - target) <= Math.abs((points[hi] as PricePoint).ms - target) ? lo : hi;
}

/** Next index for an arrow/Home/End key, or null for other keys. */
export function keyIndex(key: string, index: number, count: number): number | null {
  const max = count - 1;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, index - 1);
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(max, index + 1);
  if (key === 'Home') return 0;
  if (key === 'End') return max;
  return null;
}

const DAY = 86_400_000;

/** `Mar 2025` for monthly points, `Mar 5, 2025` for daily ones. */
export function pointDate(points: readonly PricePoint[], index: number): string {
  const p = points[index] as PricePoint;
  const neighbour = points[index + 1] ?? points[index - 1];
  const daily = neighbour !== undefined && Math.abs(neighbour.ms - p.ms) < 20 * DAY;
  return new Date(p.ms).toLocaleDateString('en-US', daily ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' } : { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export interface ScrubText {
  date: string;
  price: string;
  /** Average cost, masked when amounts are hidden. Null without any cost. */
  cost: string | null;
  /** `+$41,200 above your cost`, `−$3,100 below your cost`, masked when hidden. */
  gap: string | null;
  /** One sentence for screen readers. */
  spoken: string;
}

/** Words for one point. Market price is public; cost and gap are the user's money and mask when hidden. */
export function scrubText(points: readonly PricePoint[], index: number, averageCostCents: number | null, hidden: boolean): ScrubText {
  const p = points[index] as PricePoint;
  const date = pointDate(points, index);
  const price = formatMoney(p.cents, { precision: 'dollars' });
  const money = (cents: number, opts?: Parameters<typeof formatMoney>[1]) => {
    const t = formatMoney(cents, opts);
    return hidden ? maskDigits(t) : t;
  };
  if (averageCostCents === null) return { date, price, cost: null, gap: null, spoken: `${date}: BTC price ${price}` };
  const diff = p.cents - averageCostCents;
  const abs = Math.abs(diff);
  const cost = money(averageCostCents, { precision: 'dollars' });
  const rel = diff === 0 ? 'at your cost' : diff > 0 ? 'above your cost' : 'below your cost';
  const gap = diff === 0 ? 'At your cost' : `${diff > 0 ? '+' : '−'}${money(abs, { precision: 'dollars' }).replace('−', '')} ${diff > 0 ? 'above' : 'below'} your cost`;
  const spoken = `${date}: BTC price ${price}, your average cost ${cost}${hidden ? ' (hidden)' : `, ${money(abs, { precision: 'dollars' })} ${rel}`}`;
  return { date, price, cost, gap, spoken };
}

const TOUCH_CLEAR_MS = 1400;

/** Pointer (hover, or press-and-drag for touch and pen) and keyboard scrubbing over `count` points. */
export function useChartScrub(points: readonly PricePoint[]) {
  const [index, setIndex] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressed = useRef(false);
  const stop = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => stop, [stop]);

  const at = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return nearestIndex(points, r.width === 0 ? 0 : (e.clientX - r.left) / r.width);
  };
  const clear = () => {
    stop();
    pressed.current = false;
    setIndex(null);
  };
  return {
    index,
    clear,
    handlers: {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === 'mouse') return;
        stop();
        pressed.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Capture can fail for a synthetic pointer; scrubbing still works while it stays over the chart.
        }
        setIndex(at(e));
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === 'mouse' || pressed.current) setIndex(at(e));
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === 'mouse') return;
        pressed.current = false;
        stop();
        timer.current = setTimeout(() => setIndex(null), TOUCH_CLEAR_MS);
      },
      onPointerCancel: clear,
      onPointerLeave(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === 'mouse') clear();
      },
      onBlur: clear,
      onKeyDown(e: KeyboardEvent<HTMLElement>) {
        const next = keyIndex(e.key, index ?? points.length - 1, points.length);
        if (next === null) return;
        e.preventDefault();
        setIndex(next);
      },
    },
  };
}
