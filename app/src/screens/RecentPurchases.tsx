import { averageCostPerBtc } from '@bitcoin-basis/engine';
import { useMemo, useState } from 'react';
import { useLedger } from '../data/ledger-provider.tsx';
import { usePrice } from '../data/price-provider.tsx';
import { buildItems } from '../lib/entry-list.ts';
import { cx } from '../lib/cx.ts';
import { loanTagFor } from '../lib/loans-view.ts';
import { worthNow } from '../lib/worth-now.ts';
import { Amount } from '../ui/Amount.tsx';
import { Card } from '../ui/Card.tsx';
import { PlainMoney } from '../ui/plain-money.tsx';
import { SectionHeader, ShowMore } from '../ui/SectionHeader.tsx';
import { EntrySheet } from './entry-parts.tsx';
import { LoanBadge } from './loans/loan-parts.tsx';
import { C, DateCell, Gain, MAIN, NARROW_ONLY, Percent, RetirementTag, ROW, SUB, TABLE, TierTag, WIDE_ONLY } from './purchase-table.tsx';
import { recentPurchases, type PurchaseRow } from './recent-purchases.ts';

/** Rows at first, and how many more each "Show more" adds. */
export const PURCHASES_SHOWN = 5;
export const PURCHASES_MORE = 10;

function Row({ row, walletName, frozen, priceCents, onOpen }: { row: PurchaseRow; walletName: string; frozen: boolean; priceCents: number | null; onOpen(): void }) {
  const { state } = useLedger();
  const perBtc = averageCostPerBtc(row.costCents, row.sats);
  const worth = worthNow(row.sats, row.costCents, priceCents);
  const loan = row.retirement ? null : loanTagFor(state, row.run.item.id);
  return (
    <li className={cx(ROW, 'border-b border-line-soft last:border-b-0')}>
      <button type="button" aria-haspopup="dialog" onClick={onOpen} className={cx(ROW, 'min-h-[54px] content-center gap-y-0.5 bg-transparent py-2.5 text-left text-text @min-[56rem]:min-h-12 @min-[56rem]:items-center')}>
        <DateCell date={row.date} />
        <span className={cx(C.paid, MAIN)}>
          <span className="sr-only">Paid </span>
          <PlainMoney cents={row.costCents} />
        </span>
        <span className={cx(C.btc, MAIN, 'font-semibold')}>
          <Amount sats={row.sats} interactive={false} alwaysBtc />
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
        <span className={cx(C.tail, SUB)}>
          <span className="sr-only">, </span>
          <span className="min-w-0 truncate text-muted @min-[56rem]:text-soft">{walletName}</span>
          {loan ? <LoanBadge tag={loan.tag} /> : null}
          {row.retirement ? <RetirementTag /> : row.tier === null ? null : <TierTag tier={row.tier} />}
        </span>
      </button>
    </li>
  );
}

/** Holdings: the latest purchases (taxable and retirement), what each cost and what it is worth now. */
export function RecentPurchases() {
  const { entries, state, today } = useLedger();
  const { quote } = usePrice();
  const priceCents = quote?.usdCents ?? null;
  const [shown, setShown] = useState(PURCHASES_SHOWN);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => recentPurchases(buildItems(entries)), [entries]);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  if (rows.length === 0) return null;
  const open = rows.find((r) => r.run.item.id === openId) ?? null;
  const more = Math.min(PURCHASES_MORE, rows.length - shown);
  return (
    <Card as="section" aria-label="Recent purchases" className="@container flex flex-col">
      <SectionHeader title="Recent purchases" className="-mt-2" />
      <div className={TABLE}>
        <div aria-hidden="true" className={cx(ROW, 'border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted')}>
          <span className="col-start-1">Date</span>
          <span className={C.paid}>Paid</span>
          <span className={C.btc}>Bitcoin</span>
          <span className={cx(C.perBtc, WIDE_ONLY)}>Cost per BTC</span>
          <span className={C.now}>Now</span>
          <span className="col-span-2 col-start-6 hidden text-right @min-[56rem]:inline">Gain or loss</span>
          <span className="col-start-8 hidden @min-[56rem]:inline">Wallet</span>
        </div>
        <ul aria-label="Purchases, newest first" className={cx(ROW, 'm-0 list-none p-0')}>
          {rows.slice(0, shown).map((r) => {
            const w = wallets.get(r.wallet);
            return <Row key={r.run.item.id} row={r} walletName={w?.name ?? 'Unknown wallet'} frozen={w?.frozen ?? false} priceCents={priceCents} onOpen={() => setOpenId(r.run.item.id)} />;
          })}
        </ul>
      </div>
      {more > 0 ? <ShowMore onClick={() => setShown(shown + more)}>Show {more} more</ShowMore> : null}
      {open && <EntrySheet run={open.run} state={state} today={today} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
