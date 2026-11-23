import { averageCostPerBtc, type Loan, type LoanPurchase, type LoanSummary } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { buildItems, type EntryItem } from '../../lib/entry-list.ts';
import { countOf, shortDate } from '../../lib/format.ts';
import { Amount } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { EmptyLine, SectionCount, SectionHeader, ShowMore } from '../../ui/SectionHeader.tsx';
import { Approx, SignedMoney } from './loan-parts.tsx';
import { fromParts } from '../../lib/worth-now.ts';
import { C, Gain, MAIN, NARROW_ONLY, Percent, ROW, SUB, WIDE_ONLY } from '../purchase-table.tsx';

/** Rows shown before "Show all". */
export const LOAN_PURCHASES_SHOWN = 5;

// The Recent purchases table's grid and cells, plus the loan's two columns. Narrow (a phone): Date (year, wallet) · Paid ·
// Bitcoin (@ cost per BTC) · Now (gain, percent), then a line across the row with the interest and the gain after it.
// Wide (56rem of card and up): Date · Paid · Bitcoin · Cost per BTC · Now · Gain or loss · % · Interest · After interest.
const TABLE =
  'grid grid-cols-[max-content_repeat(3,minmax(max-content,1fr))] gap-x-2 tabular-nums @min-[56rem]:grid-cols-[minmax(7rem,1.2fr)_repeat(5,minmax(max-content,1fr))_max-content_repeat(2,minmax(max-content,1fr))] @min-[56rem]:gap-x-4';
const L = {
  date: 'col-start-1 row-span-2 flex flex-col gap-0.5 @min-[56rem]:row-span-1',
  // The wallet (or the count) on its own line under the date, across three columns, so a long name never widens the
  // date column and pushes the figures off the card. Wide: under the date, cut short with an ellipsis.
  tail: 'col-span-3 col-start-1 row-start-3 w-0 min-w-full truncate text-muted @min-[56rem]:col-span-1 @min-[56rem]:row-start-2',
  // w-0 min-w-full: the line fills the row but never sizes the columns, so a long one wraps instead of widening the table.
  interest: 'col-span-full col-start-1 row-start-4 flex w-0 min-w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg bg-bg px-2.5 py-1.5 @min-[56rem]:contents',
  share: '@min-[56rem]:col-start-8 @min-[56rem]:row-start-1 @min-[56rem]:text-right',
  after: '@min-[56rem]:col-start-9 @min-[56rem]:row-start-1 @min-[56rem]:text-right',
};

interface Figures {
  /** The cost and BTC of the coins still held, and what they cost and bought in all (null: all still held). */
  costCents: number;
  sats: number;
  of: { costCents: number; sats: number } | null;
  valueCents: number | null;
  interestCents: number;
  afterCents: number | null;
  estimated: boolean;
}

/** Paid · Bitcoin · Cost per BTC · Now · Gain · % · Interest · After interest, in the Recent purchases cells. */
function Cells({ f, total = false }: { f: Figures; total?: boolean }) {
  const worth = fromParts(f.sats, f.costCents, f.valueCents);
  const perBtc = averageCostPerBtc(f.costCents, f.sats);
  const approx = f.estimated ? <Approx /> : null;
  const strong = total ? 'font-semibold' : '';
  return (
    <>
      <span className={cx(C.paid, MAIN, strong)}>
        <span className="sr-only">, paid </span>
        <PlainMoney cents={f.costCents} />
      </span>
      {f.of !== null ? (
        <span className={cx('col-start-2 row-start-2 text-right text-muted @min-[56rem]:hidden', SUB)}>
          of <PlainMoney cents={f.of.costCents} />
        </span>
      ) : null}
      <span className={cx(C.btc, MAIN, 'font-semibold')}>
        <Amount sats={f.sats} interactive={false} alwaysBtc />
        <span className="sr-only"> BTC</span>
      </span>
      <span className={cx(C.perBtc, SUB, 'whitespace-nowrap text-muted @min-[56rem]:text-soft')}>
        {perBtc === null || total ? null : (
          <>
            <span aria-hidden="true" className={NARROW_ONLY}>
              @{' '}
            </span>
            <span className="sr-only">, cost per BTC </span>
            <PlainMoney cents={perBtc} precision="dollars" />
          </>
        )}
      </span>
      <span className={cx(C.now, MAIN, strong)}>
        <span className="sr-only">, now </span>
        {worth.valueCents === null ? '—' : <PlainMoney cents={worth.valueCents} />}
      </span>
      <Gain worth={worth} className={cx(C.gain, SUB, '@min-[56rem]:text-sm')} />
      <Percent worth={worth} className={cx(C.pct, SUB)} />
      <span className={cx(L.interest, SUB)}>
        <span className={cx(L.share, 'text-muted @min-[56rem]:text-[13px] @min-[56rem]:text-soft')}>
          {f.of !== null ? (
            <span className={NARROW_ONLY}>
              <Amount sats={f.sats} short showUnit interactive={false} /> held of <Amount sats={f.of.sats} short showUnit interactive={false} />
              {' · '}
            </span>
          ) : null}
          <span className="sr-only">, interest </span>
          {approx}
          <PlainMoney cents={f.interestCents} />
          <span className={NARROW_ONLY}> interest</span>
        </span>
        <span className={cx(L.after, 'font-semibold', total ? 'text-[15px] @min-[56rem]:text-base' : 'text-[13px] @min-[56rem]:text-sm')}>
          <span className="sr-only">, after interest </span>
          {f.afterCents === null ? '—' : <SignedMoney cents={f.afterCents} plain precision="cents" />}
          <span className={cx(NARROW_ONLY, 'text-xs font-normal text-muted')}> after interest</span>
        </span>
      </span>
    </>
  );
}

/** Date over year on a phone; `Oct 13, 2025` when wide. A `title` (Total) in place of a date. */
function When({ date = '', title }: { date?: string; title?: string }) {
  const [monthDay = '', year = ''] = date === '' ? [] : shortDate(date).split(', ');
  return (
    <span className={L.date}>
      <span className={cx(MAIN, 'whitespace-nowrap font-semibold')}>
        {title ?? (
          <>
            {monthDay}
            <span className={WIDE_ONLY}>, {year}</span>
          </>
        )}
      </span>
      {title === undefined ? <span className={cx(SUB, NARROW_ONLY, 'text-muted')}>{year}</span> : null}
    </span>
  );
}

/** The line under the date: the wallet, or the Total's count. */
function Tail({ children }: { children: ReactNode }) {
  return (
    <span className={cx(L.tail, SUB)}>
      <span className="sr-only">, </span>
      {children}
    </span>
  );
}

function PurchaseRow({ p, wallet, onOpen }: { p: LoanPurchase; wallet: string; onOpen(): void }) {
  const partly = p.heldSats !== p.sats;
  return (
    <li className={cx(ROW, 'border-b border-line-soft')}>
      <button type="button" aria-haspopup="dialog" onClick={onOpen} className={cx(ROW, 'gap-y-0.5 bg-transparent py-2.5 text-left text-text @min-[56rem]:min-h-12 @min-[56rem]:items-center')}>
        <When date={p.drawDate} />
        <Tail>
          {wallet}
          {partly ? (
            <span className={WIDE_ONLY}>
              {' · '}
              <Amount sats={p.heldSats} short showUnit interactive={false} /> held of <Amount sats={p.sats} short showUnit interactive={false} />
            </span>
          ) : null}
        </Tail>
        <Cells
          f={{
            costCents: p.heldCostCents,
            sats: p.heldSats,
            of: partly ? { costCents: p.costCents, sats: p.sats } : null,
            valueCents: p.valueCents,
            interestCents: p.interestShareCents,
            afterCents: p.gainIncludingInterestCents,
            estimated: true,
          }}
        />
      </button>
    </li>
  );
}

/**
 * The loan's purchases as a table, newest first: what each one's coins still held cost, are worth, and gained or lost
 * before and after its share of the interest. The Total row is the engine's summary, the same figures as the result at
 * the top of the page (the rows add up to it exactly: the engine sums them).
 */
export function Purchases({ loan, s, purchases, onManage, onOpen }: { loan: Loan; s: LoanSummary; purchases: LoanPurchase[]; onManage(): void; onOpen(item: EntryItem): void }) {
  const { entries, state } = useLedger();
  const [all, setAll] = useState(false);
  const items = useMemo(() => new Map(buildItems(entries).map((i) => [i.id, i])), [entries]);
  const wallets = useMemo(() => {
    const names = new Map(state.wallets.map((w) => [w.id, w.name]));
    return new Map(entries.map((e) => [e.id, 'wallet' in e ? (names.get(e.wallet) ?? '') : '']));
  }, [entries, state.wallets]);
  const newest = useMemo(() => [...purchases].sort((a, b) => (a.drawDate > b.drawDate ? -1 : a.drawDate < b.drawDate ? 1 : 0)), [purchases]);
  const shown = all ? newest : newest.slice(0, LOAN_PURCHASES_SHOWN);
  const hidden = purchases.length - shown.length;
  return (
    <Card as="section" aria-label="Purchases" className="@container flex flex-col">
      <SectionHeader title="Purchases, newest first" right={<SectionCount>{countOf(purchases.length, 'purchase')}</SectionCount>} className="-mt-2" />
      {purchases.length === 0 ? (
        <EmptyLine>Nothing linked yet. Add the purchases {loan.name} paid for.</EmptyLine>
      ) : (
        <>
          <div className={TABLE}>
            <div aria-hidden="true" className={cx(ROW, 'border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted')}>
              <span className="col-start-1">Date</span>
              <span className={C.paid}>Paid</span>
              <span className={C.btc}>Bitcoin</span>
              <span className={cx(C.perBtc, WIDE_ONLY)}>Cost per BTC</span>
              <span className={C.now}>Now</span>
              <span className="col-span-2 col-start-6 hidden text-right @min-[56rem]:inline">Gain or loss</span>
              <span className="col-start-8 hidden text-right @min-[56rem]:inline">Interest</span>
              <span className="col-start-9 hidden text-right @min-[56rem]:inline">After interest</span>
            </div>
            <ul aria-label="Purchases" className={cx(ROW, 'm-0 list-none p-0')}>
              {shown.map((p) => (
                <PurchaseRow
                  key={p.lotId}
                  p={p}
                  wallet={wallets.get(p.lotId) ?? ''}
                  onOpen={() => {
                    const item = items.get(p.lotId);
                    if (item) onOpen(item);
                  }}
                />
              ))}
            </ul>
            <div role="group" aria-label="Total" className={cx(ROW, 'gap-y-0.5 pt-3 @min-[56rem]:items-center')}>
              <When title="Total" />
              <Tail>{countOf(purchases.length, 'purchase')}</Tail>
              <Cells
                total
                f={{
                  costCents: s.heldCostCents,
                  sats: s.heldSats,
                  of: null,
                  valueCents: s.valueCents,
                  interestCents: s.interestOnPurchasesCents,
                  afterCents: s.gainIncludingInterestCents,
                  estimated: s.interestOnPurchasesEstimated,
                }}
              />
            </div>
          </div>
        </>
      )}
      {hidden > 0 ? <ShowMore onClick={() => setAll(true)}>Show all {countOf(purchases.length, 'purchase')}</ShowMore> : null}
      {!loan.closed ? (
        <Button variant="secondary" onClick={onManage} className="mt-3 self-start">
          {purchases.length === 0 ? 'Add purchases' : 'Add or remove purchases'}
        </Button>
      ) : null}
    </Card>
  );
}
