import type { Loan, LoanPurchase, LoanSummary } from '@bitcoin-basis/engine';
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

/** Rows shown before "Show all". */
export const LOAN_PURCHASES_SHOWN = 5;

// One grid; every row is a subgrid, so the columns line up (as in the wallet's lots table).
// Narrow (a phone): the purchase (date, BTC, wallet) on its own line, then Cost · Now · After interest (its interest
// share under it). Wide (38rem of card and up): Purchase · Cost · Now · Gain or loss · Interest · After interest.
const TABLE =
  'grid grid-cols-[repeat(3,minmax(max-content,1fr))] gap-x-3 tabular-nums @min-[38rem]:grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(max-content,1fr))] @min-[38rem]:gap-x-4';
const ROW = 'col-span-full grid grid-cols-subgrid';
// The narrowest phones step the figures down a size so every column still fits.
const MAIN = 'text-[13px] @max-[19.5rem]:text-xs';
const SUB = 'text-[11px] @min-[38rem]:text-xs';
const C = {
  what: 'col-span-full flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 @min-[38rem]:col-span-1 @min-[38rem]:col-start-1 @min-[38rem]:flex-col @min-[38rem]:items-start',
  cost: 'col-start-1 flex flex-col items-end gap-0.5 text-right @min-[38rem]:col-start-2',
  now: 'col-start-2 text-right @min-[38rem]:col-start-3',
  gain: 'col-start-4 hidden text-right @min-[38rem]:block',
  share: 'col-start-5 hidden text-right @min-[38rem]:block',
  after: 'col-start-3 flex flex-col items-end gap-0.5 text-right @min-[38rem]:col-start-6',
};
const NARROW_ONLY = '@min-[38rem]:hidden';

/** The cells after the first: cost of the coins still held, worth now, gain before and after the interest, the interest. */
function Figures({ cost, ofCost, value, upDown, interest, after, estimated }: { cost: number; ofCost: number | null; value: number | null; upDown: number | null; interest: number; after: number | null; estimated: boolean }) {
  const approx = estimated ? <Approx /> : null;
  return (
    <>
      <span className={cx(C.cost, MAIN)}>
        <span>
          <span className="sr-only">, cost </span>
          <PlainMoney cents={cost} />
        </span>
        {ofCost !== null ? (
          <span className={cx(SUB, 'text-muted')}>
            of <PlainMoney cents={ofCost} />
          </span>
        ) : null}
      </span>
      <span className={cx(C.now, MAIN)}>
        <span className="sr-only">, now </span>
        {value === null ? '—' : <PlainMoney cents={value} />}
      </span>
      <span className={cx(C.gain, MAIN)}>
        <span className="sr-only">, before interest </span>
        {upDown === null ? '—' : <SignedMoney cents={upDown} plain precision="cents" />}
      </span>
      <span className={cx(C.share, MAIN, 'text-soft')}>
        <span className="sr-only">, interest </span>
        {approx}
        <PlainMoney cents={interest} />
      </span>
      <span className={cx(C.after, MAIN)}>
        <span className="font-semibold">
          <span className="sr-only">, after interest </span>
          {after === null ? '—' : <SignedMoney cents={after} plain precision="cents" />}
        </span>
        <span className={cx(SUB, NARROW_ONLY, 'whitespace-nowrap font-normal text-muted')}>
          <span className="sr-only">, including </span>
          {approx}
          <PlainMoney cents={interest} /> interest
        </span>
      </span>
    </>
  );
}

function PurchaseRow({ p, wallet, onOpen }: { p: LoanPurchase; wallet: string; onOpen(): void }) {
  const btc = (sats: number) => <Amount sats={sats} short showUnit interactive={false} />;
  return (
    <li className={cx(ROW, 'border-b border-line')}>
      <button type="button" aria-haspopup="dialog" onClick={onOpen} className={cx(ROW, 'min-h-14 items-start gap-y-1 bg-transparent py-2.5 text-left text-text')}>
        <span className={cx(C.what, MAIN)}>
          <span className="whitespace-nowrap font-semibold">{shortDate(p.drawDate)}</span>
          <span className={cx(SUB, 'text-muted [overflow-wrap:anywhere]')}>
            <span className="sr-only">, </span>
            {p.heldSats === p.sats ? (
              btc(p.sats)
            ) : p.heldSats === 0 ? (
              <>{btc(p.sats)}, none held</>
            ) : (
              <>
                {btc(p.heldSats)} held of {btc(p.sats)}
              </>
            )}
            {wallet !== '' ? ` · ${wallet}` : ''}
          </span>
        </span>
        <Figures
          cost={p.heldCostCents}
          ofCost={p.heldCostCents === p.costCents ? null : p.costCents}
          value={p.valueCents}
          upDown={p.upDownCents}
          interest={p.interestShareCents}
          after={p.gainIncludingInterestCents}
          estimated
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
  let note: ReactNode = null;
  if (s.upDownCents !== null && s.gainIncludingInterestCents !== null) {
    note = (
      <p className={cx('m-0 mt-3 rounded-xl bg-bg px-3 py-2.5 text-xs leading-normal text-muted', NARROW_ONLY)}>
        <SignedMoney cents={s.upDownCents} precision="cents" /> before interest, less {s.interestOnPurchasesEstimated ? <Approx /> : null}
        <PlainMoney cents={s.interestOnPurchasesCents} /> interest = <SignedMoney cents={s.gainIncludingInterestCents} precision="cents" className="font-semibold" /> after interest
      </p>
    );
  }
  return (
    <Card as="section" aria-label="Purchases" className="@container flex flex-col">
      <SectionHeader title="Purchases, newest first" right={<SectionCount>{countOf(purchases.length, 'purchase')}</SectionCount>} className="-mt-2" />
      {purchases.length === 0 ? (
        <EmptyLine>Nothing linked yet. Add the purchases {loan.name} paid for.</EmptyLine>
      ) : (
        <>
          <div className={TABLE}>
            <div aria-hidden="true" className={cx(ROW, 'border-b border-line pb-1.5 text-[11px] text-muted')}>
              <span className="col-start-1 hidden @min-[38rem]:block">Purchase</span>
              <span className={C.cost}>Cost</span>
              <span className={C.now}>Now</span>
              <span className={C.gain}>Gain or loss</span>
              <span className={C.share}>Interest</span>
              <span className={C.after}>After interest</span>
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
            <div role="group" aria-label="Total" className={cx(ROW, 'items-start gap-y-1 pt-2.5 font-semibold')}>
              <span className={cx(C.what, MAIN)}>
                <span>Total</span>
                <span className={cx(SUB, 'font-normal text-muted')}>
                  <span className="sr-only">, </span>
                  {hidden > 0 ? `All ${countOf(purchases.length, 'purchase')} · ` : ''}
                  <Amount sats={s.heldSats} short showUnit interactive={false} /> held
                </span>
              </span>
              <Figures
                cost={s.heldCostCents}
                ofCost={null}
                value={s.valueCents}
                upDown={s.upDownCents}
                interest={s.interestOnPurchasesCents}
                after={s.gainIncludingInterestCents}
                estimated={s.interestOnPurchasesEstimated}
              />
            </div>
          </div>
          {note}
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
