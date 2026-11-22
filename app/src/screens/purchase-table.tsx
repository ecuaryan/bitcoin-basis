import type { Lot } from '@bitcoin-basis/engine';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { maskDigits, shortDate } from '../lib/format.ts';
import { TIER_LABEL } from '../lib/origin.ts';
import type { WorthNow } from '../lib/worth-now.ts';
import { PlainMoney } from '../ui/plain-money.tsx';
import { usePrefs } from '../ui/prefs.tsx';
import { TIER_BG } from './holdings-parts.tsx';

/** The purchase-style table shared by the wallet's lots and Holdings' recent purchases. */

// One grid for the whole table; every row is a subgrid, so columns line up across rows.
// Narrow (phones, a narrow desktop column): Date · Paid · Bitcoin (@ cost per BTC) · Now (gain, percent).
// Wide (56rem of card and up): Date · Paid · Bitcoin · Cost per BTC · Now · Gain or loss · % · a last column (Term for lots,
// Wallet for purchases), one line each. On narrow cards that last column is the row's third line, beside the percent.
export const TABLE =
  'grid grid-cols-[max-content_repeat(3,minmax(max-content,1fr))] gap-x-2 tabular-nums @min-[56rem]:grid-cols-[max-content_repeat(5,minmax(max-content,1fr))_max-content_minmax(max-content,2fr)] @min-[56rem]:gap-x-4';
export const ROW = 'col-span-full grid grid-cols-subgrid';
// The narrowest phones (under 19.5rem of card) step the figures down a size so every column still fits.
export const MAIN = 'text-[13px] @max-[19.5rem]:text-xs @min-[56rem]:text-sm';
export const SUB = 'text-xs @min-[56rem]:text-[13px]';
export const C = {
  date: 'col-start-1 row-span-2 flex flex-col gap-0.5 @min-[56rem]:row-span-1 @min-[56rem]:flex-row @min-[56rem]:gap-0',
  paid: 'col-start-2 row-start-1 text-right',
  btc: 'col-start-3 row-start-1 text-right',
  perBtc: 'col-start-3 row-start-2 text-right @min-[56rem]:col-start-4 @min-[56rem]:row-start-1',
  now: 'col-start-4 row-start-1 text-right @min-[56rem]:col-start-5',
  gain: 'col-start-4 row-start-2 text-right @min-[56rem]:col-start-6 @min-[56rem]:row-start-1',
  pct: 'col-start-4 row-start-3 text-right @min-[56rem]:col-start-7 @min-[56rem]:row-start-1',
  tail: 'col-span-3 col-start-1 row-start-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @min-[56rem]:col-span-1 @min-[56rem]:col-start-8 @min-[56rem]:row-start-1',
};
export const WIDE_ONLY = 'hidden @min-[56rem]:inline';
export const NARROW_ONLY = '@min-[56rem]:hidden';

export function tone(cents: number | null): string {
  return cents === null || cents === 0 ? 'text-muted' : cents > 0 ? 'text-accent' : 'text-loss';
}

/** `−10%`, `+6%`, `under 1%`; digits hidden with the amounts. Empty with no percent. */
export function Percent({ worth, className }: { worth: WorthNow; className?: string }) {
  const { masked } = usePrefs();
  const { percent, gainCents } = worth;
  if (percent === null || gainCents === null || gainCents === 0) return null;
  const text = percent === 0 ? 'under 1%' : `${gainCents > 0 ? '+' : '−'}${Math.abs(percent)}%`;
  return <span className={cx('whitespace-nowrap font-medium', tone(gainCents), className)}>{masked ? maskDigits(text) : text}</span>;
}

export function Gain({ worth, className }: { worth: WorthNow; className?: string }) {
  if (worth.gainCents === null) return <span className={cx('text-muted', className)}>—</span>;
  if (worth.gainCents === 0) return <span className={cx('text-muted', className)}>even</span>;
  return (
    <span className={cx('whitespace-nowrap font-semibold', tone(worth.gainCents), className)}>
      <span className="sr-only">{worth.gainCents > 0 ? 'up ' : 'down '}</span>
      <PlainMoney cents={worth.gainCents} signed />
    </span>
  );
}

/** Date over year on a phone; one line (`Mar 30, 2026`) when wide. */
export function DateCell({ date, children }: { date: string; children?: ReactNode }) {
  const [monthDay = '', year = ''] = shortDate(date).split(', ');
  return (
    <span className={C.date}>
      <span className={cx(MAIN, 'whitespace-nowrap font-semibold')}>
        {monthDay}
        <span className={WIDE_ONLY}>, {year}</span>
      </span>
      <span className={cx(SUB, NARROW_ONLY, 'text-muted')}>{year}</span>
      {children}
    </span>
  );
}

export function TierTag({ tier }: { tier: Lot['tier'] }) {
  if (tier === 'documented') return null;
  return (
    <span className="flex flex-none items-center gap-1 rounded-md border border-line px-1.5 text-[11px] font-semibold leading-4 text-soft">
      <span aria-hidden="true" className={cx('size-1.5 rounded-full', TIER_BG[tier])} />
      {TIER_LABEL[tier]}
    </span>
  );
}
