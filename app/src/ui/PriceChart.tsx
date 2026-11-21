import { useId } from 'react';
import type { PricePoint } from '../data/price-history.ts';
import { cx } from '../lib/cx.ts';
import { scrubText, useChartScrub } from './chart-scrub.ts';
import { usePrefs } from './prefs.tsx';

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
  const { masked } = usePrefs();
  const scrub = useChartScrub(points);
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

  const idx = scrub.index;
  const shown = idx ?? points.length - 1;
  const text = scrubText(points, shown, averageCostCents, masked);
  const cur = points[shown] as PricePoint;
  const pct = (x(cur.ms) / width) * 100;
  const dotTop = (y(cur.cents) / height) * 100;
  const flip = pct > 50;
  return (
    <div className="relative">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={shown}
        aria-valuetext={text.spoken}
        className="relative touch-pan-y select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        {...scrub.handlers}
      >
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false" className={cx('block', className)}>
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
        {idx !== null && (
          <div aria-hidden="true" data-testid="chart-scrub" className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 w-px bg-soft/60" style={{ left: `${pct}%` }} />
            <div className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent" style={{ left: `${pct}%`, top: `${dotTop}%` }} />
            <div
              data-testid="chart-scrub-label"
              className={cx('absolute top-0 flex w-max max-w-[58%] flex-col gap-px rounded-lg border border-line bg-surface-2/95 px-2 py-1 text-[11px] leading-snug tabular-nums text-text', flip && '-translate-x-full')}
              style={{ left: flip ? `calc(${pct}% - 10px)` : `calc(${pct}% + 10px)` }}
            >
              <span className="text-muted">{text.date}</span>
              <span className="text-soft">
                BTC price <span className="font-semibold text-text">{text.price}</span>
              </span>
              {text.gap !== null && <span className={text.gap.startsWith('\u2212') ? 'text-loss' : 'text-accent'}>{text.gap}</span>}
            </div>
          </div>
        )}
      </div>
      {/* sr-only on a <table> itself still lays out its rows in Chromium; hide a wrapper instead. */}
      <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Price</th>
            {averageCostCents !== null && <th scope="col">Compared with your average cost</th>}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => {
            const t = scrubText(points, i, averageCostCents, masked);
            return (
              <tr key={p.ms}>
                <th scope="row">{t.date}</th>
                <td>{t.price}</td>
                {t.gap !== null && <td>{t.gap}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
