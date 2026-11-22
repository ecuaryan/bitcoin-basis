import { averageCostPerBtc, oneYearAnniversary, termFor, type Entry, type Lot, type Wallet } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { countOf, maskDigits, shortDate } from '../../lib/format.ts';
import { describeOrigin, TIER_LABEL } from '../../lib/origin.ts';
import { LOT_HELP, LOT_HELP_LABEL, TERM_HELP } from '../../lib/terms.ts';
import { loanTagFor } from '../../lib/loans-view.ts';
import { sumWorth, worthNow, type WorthNow } from '../../lib/worth-now.ts';
import { Amount } from '../../ui/Amount.tsx';
import { Card } from '../../ui/Card.tsx';
import { useHelp } from '../../ui/Help.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { usePrefs } from '../../ui/prefs.tsx';
import { EmptyLine, SectionHeader, ShowMore } from '../../ui/SectionHeader.tsx';
import { LoanBadge } from '../loans/loan-parts.tsx';
import { TIER_BG } from '../holdings-parts.tsx';
import { nextDay } from '../log/model.ts';

/** Rows shown before "Show all": the table's rows are short, so a few more than a list's five. */
export const LOTS_SHOWN = 8;

export interface LotGroups {
  short: Lot[];
  long: Lot[];
  /** Every lot in the wallet. */
  total: number;
}

/**
 * The wallet's lots for the table: short-term first, then long-term, each newest first (a gift can arrive long-term,
 * so the two are grouped, not cut at one date). Without `all`, only the first `LOTS_SHOWN` across both groups.
 */
export function lotGroups(lots: readonly Lot[], today: string, all: boolean): LotGroups {
  const newest = [...lots].sort((a, b) => (a.acquiredAt > b.acquiredAt ? -1 : a.acquiredAt < b.acquiredAt ? 1 : 0));
  const short = newest.filter((l) => termFor(l, today) === 'short');
  const long = newest.filter((l) => termFor(l, today) === 'long');
  if (all) return { short, long, total: lots.length };
  return { short: short.slice(0, LOTS_SHOWN), long: long.slice(0, Math.max(0, LOTS_SHOWN - short.length)), total: lots.length };
}

/** `Long-term on Apr 12, 2027`: the day after the one-year anniversary. */
export function longTermOn(lot: Pick<Lot, 'acquiredDate'>): string {
  return `Long-term on ${shortDate(nextDay(oneYearAnniversary(lot.acquiredDate)))}`;
}

// One grid for the whole table; every row is a subgrid, so columns line up across rows.
// Narrow (phones, a narrow desktop column): Date · Paid · Bitcoin (@ cost per BTC) · Now (gain, percent).
// Wide (56rem of card and up): Date · Paid · Bitcoin · Cost per BTC · Now · Gain or loss · % · Term, one line each.
const TABLE =
  'grid grid-cols-[max-content_repeat(3,minmax(max-content,1fr))] gap-x-2 tabular-nums @min-[56rem]:grid-cols-[max-content_repeat(5,minmax(max-content,1fr))_max-content_minmax(max-content,2fr)] @min-[56rem]:gap-x-4';
const ROW = 'col-span-full grid grid-cols-subgrid';
// The narrowest phones (under 19.5rem of card) step the figures down a size so every column still fits.
const MAIN = 'text-[13px] @max-[19.5rem]:text-xs @min-[56rem]:text-sm';
const SUB = 'text-xs @min-[56rem]:text-[13px]';
const C = {
  date: 'col-start-1 row-span-2 flex flex-col gap-0.5 @min-[56rem]:row-span-1 @min-[56rem]:flex-row @min-[56rem]:gap-0',
  paid: 'col-start-2 row-start-1 text-right',
  btc: 'col-start-3 row-start-1 text-right',
  perBtc: 'col-start-3 row-start-2 text-right @min-[56rem]:col-start-4 @min-[56rem]:row-start-1',
  now: 'col-start-4 row-start-1 text-right @min-[56rem]:col-start-5',
  gain: 'col-start-4 row-start-2 text-right @min-[56rem]:col-start-6 @min-[56rem]:row-start-1',
  pct: 'col-start-4 row-start-3 text-right @min-[56rem]:col-start-7 @min-[56rem]:row-start-1',
  term: 'col-span-3 col-start-1 row-start-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @min-[56rem]:col-span-1 @min-[56rem]:col-start-8 @min-[56rem]:row-start-1',
};
const WIDE_ONLY = 'hidden @min-[56rem]:inline';
const NARROW_ONLY = '@min-[56rem]:hidden';

function tone(cents: number | null): string {
  return cents === null || cents === 0 ? 'text-muted' : cents > 0 ? 'text-accent' : 'text-loss';
}

/** `−10%`, `+6%`, `under 1%`; digits hidden with the amounts. Empty with no percent. */
function Percent({ worth, className }: { worth: WorthNow; className?: string }) {
  const { masked } = usePrefs();
  const { percent, gainCents } = worth;
  if (percent === null || gainCents === null || gainCents === 0) return null;
  const text = percent === 0 ? 'under 1%' : `${gainCents > 0 ? '+' : '−'}${Math.abs(percent)}%`;
  return <span className={cx('whitespace-nowrap font-medium', tone(gainCents), className)}>{masked ? maskDigits(text) : text}</span>;
}

function Gain({ worth, className }: { worth: WorthNow; className?: string }) {
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
function DateCell({ date, children }: { date: string; children?: ReactNode }) {
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

function TierTag({ tier }: { tier: Lot['tier'] }) {
  if (tier === 'documented') return null;
  return (
    <span className="flex flex-none items-center gap-1 rounded-md border border-line px-1.5 text-[11px] font-semibold leading-4 text-soft">
      <span aria-hidden="true" className={cx('size-1.5 rounded-full', TIER_BG[tier])} />
      {TIER_LABEL[tier]}
    </span>
  );
}

function LotRow({ lot, today, priceCents, frozen, open, onToggle, origin, walletsById }: { lot: Lot; today: string; priceCents: number | null; frozen: boolean; open: boolean; onToggle(): void; origin: Entry | undefined; walletsById: ReadonlyMap<string, Wallet> }) {
  const { state } = useLedger();
  const long = termFor(lot, today) === 'long';
  const perBtc = averageCostPerBtc(lot.costCents, lot.sats);
  const worth = worthNow(lot.sats, lot.costCents, priceCents);
  const loan = loanTagFor(state, lot.id);
  const tags = (
    <>
      {loan ? <LoanBadge tag={loan.tag} /> : null}
      <TierTag tier={lot.tier} />
    </>
  );
  return (
    <li className={cx(ROW, 'border-b border-line-soft last:border-b-0')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className={cx(ROW, 'min-h-[54px] content-center gap-y-0.5 bg-transparent py-2.5 text-left text-text @min-[56rem]:min-h-12 @min-[56rem]:items-center')}>
        <DateCell date={lot.acquiredDate} />
        <span className={cx(C.paid, MAIN)}>
          <span className="sr-only">Paid </span>
          <PlainMoney cents={lot.costCents} />
        </span>
        <span className={cx(C.btc, MAIN, 'font-semibold')}>
          <Amount sats={lot.sats} interactive={false} alwaysBtc />
          <span className="sr-only"> BTC</span>
        </span>
        <span className={cx(C.perBtc, SUB, 'whitespace-nowrap text-muted @min-[56rem]:text-soft')}>
          <span aria-hidden="true" className={NARROW_ONLY}>
            @{' '}
          </span>
          <span className="sr-only">, cost per BTC </span>
          {perBtc === null ? '—' : <PlainMoney cents={perBtc} precision="dollars" />}
        </span>
        {frozen ? (
          <span className={cx(C.now, MAIN, 'text-muted')}>Frozen</span>
        ) : (
          <>
            <span className={cx(C.now, MAIN)}>
              <span className="sr-only">, now </span>
              {worth.valueCents === null ? '—' : <PlainMoney cents={worth.valueCents} />}
            </span>
            <Gain worth={worth} className={cx(C.gain, SUB, '@min-[56rem]:text-sm')} />
            <Percent worth={worth} className={cx(C.pct, SUB)} />
          </>
        )}
        <span className={cx(C.term, SUB)}>
          {long ? (
            <span className={cx(WIDE_ONLY, 'text-muted')}>Long-term</span>
          ) : (
            <span className="whitespace-nowrap font-semibold text-amber">{longTermOn(lot)}</span>
          )}
          {tags}
        </span>
      </button>
      {open ? (
        <dl className="col-span-full mb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-bg px-3 py-2.5 text-xs">
          <dt className="text-muted">Came from</dt>
          <dd className="m-0">{describeOrigin(lot, origin, walletsById)}</dd>
          <dt className="text-muted">Cost per BTC</dt>
          <dd className="m-0">{perBtc === null ? '—' : <PlainMoney cents={perBtc} />}</dd>
          <dt className="text-muted">Receipt</dt>
          <dd className="m-0">{lot.proof || 'None yet'}</dd>
        </dl>
      ) : null}
    </li>
  );
}

function GroupHeading({ title, note, className }: { title: string; note: string; className: string }) {
  return (
    <div className="col-span-full flex items-baseline justify-between gap-3 pb-0.5 pt-3.5 @min-[56rem]:justify-start">
      <h3 className={cx('m-0 text-[13px] font-bold', className)}>{title}</h3>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}

function TotalRow({ lots, priceCents, frozen }: { lots: readonly Lot[]; priceCents: number | null; frozen: boolean }) {
  const worth = sumWorth(lots, priceCents);
  const avg = averageCostPerBtc(worth.costCents, worth.sats);
  return (
    <div role="group" aria-label="All lots in this wallet" className={cx(ROW, 'gap-y-0.5 border-t-[1.5px] border-line py-3 font-bold @min-[56rem]:items-center')}>
      <span className={C.date}>
        <span className="text-xs uppercase tracking-[0.06em] text-soft">Total</span>
        <span className="text-xs font-medium text-muted @min-[56rem]:pl-1.5">
          <span className={WIDE_ONLY}>· </span>
          {countOf(lots.length, 'lot')}
        </span>
      </span>
      <span className={cx(C.paid, MAIN)}>
        <span className="sr-only">Paid </span>
        <PlainMoney cents={worth.costCents} />
      </span>
      <span className={cx(C.btc, MAIN)}>
        <Amount sats={worth.sats} interactive={false} alwaysBtc />
        <span className="sr-only"> BTC</span>
      </span>
      <span className={cx(C.perBtc, SUB, 'whitespace-nowrap font-medium text-muted @min-[56rem]:text-soft')}>
        avg {avg === null ? '—' : <PlainMoney cents={avg} precision="dollars" />}
      </span>
      {frozen ? (
        <span className={cx(C.now, MAIN, 'text-muted')}>Frozen</span>
      ) : (
        <>
          <span className={cx(C.now, MAIN)}>
            <span className="sr-only">, now </span>
            {worth.valueCents === null ? '—' : <PlainMoney cents={worth.valueCents} />}
          </span>
          <Gain worth={worth} className={cx(C.gain, SUB, 'font-bold @min-[56rem]:text-sm')} />
          <Percent worth={worth} className={cx(C.pct, SUB)} />
        </>
      )}
    </div>
  );
}

/** The wallet's lots as a table: what each cost, what it is worth now, and when it turns long-term. */
export function LotsSection({ lots, today, entries, walletsById, priceCents, frozen = false }: { lots: Lot[]; today: string; entries: readonly Entry[]; walletsById: ReadonlyMap<string, Wallet>; priceCents: number | null; frozen?: boolean }) {
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => lotGroups(lots, today, all), [lots, today, all]);
  const shownCount = groups.short.length + groups.long.length;
  // One "?": what a lot is, then the two tax clocks the table groups by.
  const lotHelp = useHelp(`${LOT_HELP_LABEL.slice(0, -1)}, and what are short-term and long-term?`, `${LOT_HELP} ${TERM_HELP}`);
  const row = (l: Lot) => (
    <LotRow
      key={l.id}
      lot={l}
      today={today}
      priceCents={priceCents}
      frozen={frozen}
      open={openId === l.id}
      onToggle={() => setOpenId(openId === l.id ? null : l.id)}
      origin={entries.find((e) => e.id === l.originEntryId)}
      walletsById={walletsById}
    />
  );
  return (
    <Card as="section" aria-label="Lots in this wallet" className="@container flex flex-col">
      <SectionHeader title="Lots, newest first" help={lotHelp.button} className="-mt-2" />
      {lotHelp.panel}
      {lots.length === 0 ? (
        <EmptyLine>No lots here.</EmptyLine>
      ) : (
        <div className={cx(TABLE, 'mt-1')}>
          <div aria-hidden="true" className={cx(ROW, 'border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted')}>
            <span className="col-start-1">Date</span>
            <span className={C.paid}>Paid</span>
            <span className={C.btc}>Bitcoin</span>
            <span className={cx(C.perBtc, WIDE_ONLY)}>Cost per BTC</span>
            <span className={C.now}>Now</span>
            <span className="col-span-2 col-start-6 hidden text-right @min-[56rem]:inline">Gain or loss</span>
            <span className="col-start-8 hidden pl-0 @min-[56rem]:inline">Term</span>
          </div>
          {frozen ? <p className="col-span-full m-0 pt-2.5 text-xs text-muted">Frozen · not counted in what your Bitcoin is worth</p> : null}
          {groups.short.length > 0 ? (
            <>
              <GroupHeading title="Short-term" note="Gains taxed like wages" className="text-amber" />
              <ul aria-label="Short-term lots" className={cx(ROW, 'm-0 list-none p-0')}>
                {groups.short.map(row)}
              </ul>
            </>
          ) : null}
          {groups.long.length > 0 ? (
            <>
              <GroupHeading title="Long-term" note="Gains taxed at a lower rate" className="text-soft" />
              <ul aria-label="Long-term lots" className={cx(ROW, 'm-0 list-none p-0')}>
                {groups.long.map(row)}
              </ul>
            </>
          ) : null}
          {lots.length > 1 ? <TotalRow lots={lots} priceCents={priceCents} frozen={frozen} /> : null}
        </div>
      )}
      {groups.total > shownCount ? <ShowMore onClick={() => setAll(true)}>Show all {countOf(groups.total, 'lot')}</ShowMore> : null}
    </Card>
  );
}
