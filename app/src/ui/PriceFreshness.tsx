import { useEffect, useState } from 'react';
import type { PriceQuote } from '../data/price.ts';
import { usePrice } from '../data/price-provider.tsx';
import { cx } from '../lib/cx.ts';
import { shortWhen } from '../lib/format.ts';
import { RefreshIcon } from './more-icons.tsx';

/** A live price older than this shows its time. */
export const PRICE_OLD_MS = 5 * 60_000;
/** A live price older than this shows its time in amber. */
export const PRICE_VERY_OLD_MS = 30 * 60_000;

/**
 * `as of 3:12 PM` when the live price shown is not current: older than 5 minutes, or a kept price the server
 * sent while it could not reach its sources (`stale`). Null for a current price, the demo's fixed one and a typed one.
 */
export function priceAge(quote: PriceQuote | null, nowMs: number): { text: string; veryOld: boolean } | null {
  if (quote === null || quote.source !== 'live') return null;
  const age = nowMs - quote.asOf;
  if (!quote.stale && age <= PRICE_OLD_MS) return null;
  return { text: `as of ${shortWhen(quote.asOf, nowMs)}`, veryOld: age > PRICE_VERY_OLD_MS };
}

/** The time now, updated every 30 seconds while `on`, so a price that ages while you look says so. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** ` · as of 3:12 PM` after a price that is not current (muted; amber past 30 minutes), nothing otherwise. */
export function PriceAge({ quote }: { quote: PriceQuote | null }) {
  const now = useNow(quote?.source === 'live');
  const age = priceAge(quote, Math.max(now, quote?.fetchedAt ?? 0));
  if (age === null) return null;
  return (
    <>
      {' '}
      <span aria-hidden="true">·</span> <span className={age.veryOld ? 'text-amber' : undefined}>{age.text}</span>
    </>
  );
}

/**
 * A small refresh icon beside the price: asks for the live price again now and spins while it loads. Its hit area
 * is 44px, made with padding and an equal negative margin, so the text around it does not move.
 */
export function PriceRefreshButton({ className }: { className?: string }) {
  const { status, refresh } = usePrice();
  return (
    <button
      type="button"
      onClick={refresh}
      aria-label="Refresh the price"
      title="Refresh the price"
      className={cx('-m-3.5 flex-none self-center rounded-full bg-transparent p-3.5 text-muted hover:text-soft active:text-soft', className)}
    >
      <RefreshIcon size={16} className={cx('block', status === 'loading' && 'animate-spin')} />
    </button>
  );
}
