import { useId } from 'react';
import type { PricePoint } from '../data/price-history.ts';
import { cx } from '../lib/cx.ts';

/**
 * Price over time with the average-cost line under it. The gap between the two, where price is above
 * cost, is filled orange. Hand-rolled SVG: no chart library.
 */
export function PriceChart({
  points,
  averageCostCents,
  width,
  height,
  label,
  className,
  strokeWidth = 2.2,
  status = 'ready',
  young = false,
}: {
  points: readonly PricePoint[];
  averageCostCents: number | null;
  /** viewBox size; the SVG stretches to its container width. */
  width: number;
  height: number;
  label: string;
  className?: string;
  strokeWidth?: number;
  /** `loading` shows a quiet placeholder instead of an error while the history is on its way. */
  status?: 'loading' | 'ready';
  /** The records are new, so a short chart is expected rather than broken. */
  young?: boolean;
}) {
  const id = useId();
  if (points.length < 2) {
    const text = status === 'loading' ? 'Loading price history…' : young ? 'Your chart fills in as time passes.' : 'Price history is not available right now';
    return (
      <div className={cx('flex items-center justify-center rounded-xl bg-surface-2 text-xs text-muted', status === 'loading' && 'animate-pulse', className)} style={{ height }} role="img" aria-label={text}>
        {text}
      </div>
    );
  }
  const first = points[0] as PricePoint;
  const lastPoint = points[points.length - 1] as PricePoint;
  const values = points.map((p) => p.cents);
  const lo = Math.min(...values, averageCostCents ?? Infinity);
  const hi = Math.max(...values, averageCostCents ?? -Infinity);
  const span = Math.max(1, hi - lo);
  const padTop = height * 0.12;
  const padBottom = height * 0.1;
  const y = (cents: number) => padTop + ((hi - cents) / span) * (height - padTop - padBottom);
  const x = (ms: number) => ((ms - first.ms) / Math.max(1, lastPoint.ms - first.ms)) * width;
  const f = (n: number) => n.toFixed(1);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(x(p.ms))} ${f(y(p.cents))}`).join(' ');
  const avgY = averageCostCents === null ? null : y(averageCostCents);
  const fill = avgY === null ? null : `${line} L${f(width)} ${f(avgY)} L0 ${f(avgY)} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className={className}>
      <defs>
        <linearGradient id={`${id}-gap`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7931A" stopOpacity="0.35" />
          <stop offset="1" stopColor="#F7931A" stopOpacity="0.02" />
        </linearGradient>
        {avgY !== null && (
          <clipPath id={`${id}-above`}>
            <rect x="0" y="0" width={width} height={avgY} />
          </clipPath>
        )}
      </defs>
      {fill !== null && <path d={fill} fill={`url(#${id}-gap)`} clipPath={`url(#${id}-above)`} />}
      <path d={line} fill="none" stroke="#F7931A" strokeWidth={strokeWidth} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {avgY !== null && <path d={`M0 ${f(avgY)} L${f(width)} ${f(avgY)}`} stroke="#C9C4BC" strokeWidth={strokeWidth * 0.55} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
