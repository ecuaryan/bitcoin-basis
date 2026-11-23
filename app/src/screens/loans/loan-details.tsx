import { formatAprPercent, type Loan, type LoanPurchase, type LoanSummary } from '@bitcoin-basis/engine';
import type { ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { countOf, shortDate } from '../../lib/format.ts';
import { goneWords, statementDayText } from '../../lib/loans-view.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Approx, OwedNowParts, SignedMoney } from './loan-parts.tsx';

/** One fact: a label, its value on the right, and an optional line under both. */
type Fact = { k: string; v: ReactNode; sub?: ReactNode };

/** A small uppercase heading over a list of facts, each on its own line with a hairline between. */
function Group({ title, facts }: { title: string; facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <>
      <h3 className="m-0 mt-2.5 text-[11px] font-semibold tracking-[0.06em] text-muted first-of-type:mt-1">{title.toUpperCase()}</h3>
      <dl aria-label={title} className="m-0 flex flex-col">
        {facts.map((f, i) => (
          <div key={f.k} className={cx('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-[3px] py-2.5', i < facts.length - 1 && 'border-b border-line')}>
            <dt className="text-sm text-soft">{f.k}</dt>
            <dd className="m-0 text-right text-sm font-semibold">{f.v}</dd>
            {f.sub ? <dd className="col-span-full m-0 text-xs leading-[1.45] text-muted">{f.sub}</dd> : null}
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * The rate's history from `loan.rates`, newest first: `Since Jul 1, 2026. Before that: 6.75% from Mar 1, 2025.` A rate set
 * for a day still to come is listed first (`Then 7.00% from …`). One rate: `From the start, Mar 1, 2025`.
 */
export function rateHistory(rates: Loan['rates'], today: string): string {
  const current = Math.max(0, rates.findLastIndex((r) => r.from <= today));
  const at = (i: number) => rates[i] as Loan['rates'][number];
  const from = (i: number) => (i === 0 ? `from the start, ${shortDate(at(i).from)}` : `from ${shortDate(at(i).from)}`);
  const parts: string[] = [];
  const later = rates.slice(current + 1).map((r) => `${formatAprPercent(r.aprMillionths)} from ${shortDate(r.from)}`);
  if (later.length > 0) parts.push(`Then ${later.join(', ')}.`);
  parts.push(current === 0 ? `From the start, ${shortDate(at(0).from)}.` : `Since ${shortDate(at(current).from)}.`);
  const earlier = rates
    .slice(0, current)
    .map((r, i) => `${formatAprPercent(r.aprMillionths)} ${from(i)}`)
    .reverse();
  if (earlier.length > 0) parts.push(`Before that: ${earlier.join(', ')}.`);
  return parts.join(' ');
}

/** Where the money drawn went, and what is owed or paid ahead after what was paid back; every part adds up. */
function BorrowedParts({ s }: { s: LoanSummary }) {
  const split = s.purchasesDrawnCents > 0 && s.otherDrawsCents > 0;
  const repaid = s.principalRepaidCents > 0;
  return (
    <>
      {split ? (
        <>
          <Money cents={s.purchasesDrawnCents} /> for purchases + <Money cents={s.otherDrawsCents} /> for other things
        </>
      ) : s.otherDrawsCents > 0 ? (
        'All of it for other things'
      ) : (
        'All of it for purchases'
      )}
      {repaid ? (
        <>
          , less <Money cents={s.principalRepaidCents} /> paid back ={' '}
          {s.creditCents > 0 ? (
            <>
              <Money cents={s.creditCents} /> paid in advance
            </>
          ) : (
            <>
              <Money cents={s.principalOwedCents} /> owed
            </>
          )}
        </>
      ) : null}
    </>
  );
}

/** What "Charged to the purchases" leaves out: interest on money drawn for other things, and days before any purchase. */
function OtherInterest({ s }: { s: LoanSummary }) {
  const other = s.interestNotOnPurchasesCents;
  if (other === 0) return <>All of the interest paid. It is in the result above.</>;
  const draws = s.otherDrawsCents > 0;
  const early = s.unallocatedInterestCents > 0;
  return (
    <>
      The interest in the result above. The other {draws ? <Approx /> : null}
      <Money cents={other} /> was{' '}
      {draws ? (
        <>
          on the <Money cents={s.otherDrawsCents} /> drawn for other things
          {early ? (
            <>
              , <Money cents={s.unallocatedInterestCents} /> of it for days before any purchase
            </>
          ) : null}
          .
        </>
      ) : (
        'for days before any purchase, so no purchase carries it.'
      )}
    </>
  );
}

/** The loan page's details in three groups (the loan, interest, the Bitcoin), every figure from the engine. */
export function Details({ loan, s, purchases, onRate }: { loan: Loan; s: LoanSummary; purchases: readonly LoanPurchase[]; onRate(): void }) {
  const { today } = useLedger();
  const gone = goneWords(purchases);
  const variable = loan.rates.length > 1;
  const day = statementDayText(loan.statementDay);
  const allHeld = s.heldSats === s.boughtSats;
  const left = s.proceedsCents > 0 || s.recoveredCents > 0;

  const theLoan: Fact[] = [
    ...(s.owedNowEstimated
      ? [
          {
            k: 'Owed now, with interest',
            v: (
              <>
                <Approx />
                <Money cents={s.owedNowCents} />
              </>
            ),
            sub: <OwedNowParts s={s} today={today} />,
          },
        ]
      : []),
    { k: 'Borrowed in all', v: <Money cents={s.drawnCents} />, ...(s.drawnCents > 0 ? { sub: <BorrowedParts s={s} /> } : {}) },
    {
      k: 'Rate',
      v: (
        <>
          {formatAprPercent(s.aprMillionths)} APR{variable ? <span className="font-normal text-muted"> (variable)</span> : null}
        </>
      ),
      sub: (
        <>
          {rateHistory(loan.rates, today)}
          {!loan.closed ? (
            <span className="mt-2 block">
              <Button variant="secondary" onClick={onRate}>
                Rate changed
              </Button>
            </span>
          ) : null}
        </>
      ),
    },
    { k: 'Statement closes', v: day === 'Not set' || day.startsWith('Last') ? day : `${day} of each month` },
  ];

  const interest: Fact[] = [
    { k: 'Interest paid', v: <Money cents={s.interestPaidCents} />, ...(s.interestPaidThrough ? { sub: `Through ${shortDate(s.interestPaidThrough)}` } : {}) },
    ...(s.purchaseCount > 0
      ? [
          {
            k: 'Charged to the purchases',
            v: (
              <>
                {s.interestOnPurchasesEstimated ? <Approx /> : null}
                <Money cents={s.interestOnPurchasesCents} />
              </>
            ),
            sub: <OtherInterest s={s} />,
          },
        ]
      : []),
  ];

  const bitcoin: Fact[] =
    s.purchaseCount === 0
      ? []
      : [
          {
            k: 'Bought',
            v: <Amount sats={s.boughtSats} showUnit interactive={false} />,
            sub: (
              <>
                {countOf(s.purchaseCount, 'purchase')} for <Money cents={s.purchasesCostCents} />
                {allHeld ? ', all still held' : ''}
              </>
            ),
          },
          ...(!allHeld
            ? [
                {
                  k: 'Still held',
                  v: <Amount sats={s.heldSats} showUnit interactive={false} />,
                  sub: (
                    <>
                      {gone !== null ? (
                        <span className="block">
                          <Amount sats={gone.sats} showUnit interactive={false} /> {gone.words}
                        </span>
                      ) : null}
                      {s.frozenSats > 0 ? (
                        <span className="block">
                          <Amount sats={s.frozenSats} showUnit interactive={false} /> in a frozen wallet
                        </span>
                      ) : null}
                    </>
                  ),
                },
              ]
            : []),
          ...(s.proceedsCents > 0
            ? [
                {
                  k: 'Sold or spent for',
                  v: <Money cents={s.proceedsCents} />,
                  sub: (
                    <>
                      <Amount sats={s.soldSats} showUnit interactive={false} /> that cost <Money cents={s.soldCostCents} />
                    </>
                  ),
                },
              ]
            : []),
          ...(s.recoveredCents > 0 ? [{ k: 'Paid back by a frozen platform', v: <Money cents={s.recoveredCents} /> }] : []),
          ...(left && s.overallResultCents !== null && s.valueCents !== null
            ? [
                {
                  k: 'Whole result, with what already left',
                  v: <SignedMoney cents={s.overallResultCents} precision="cents" />,
                  sub: (
                    <>
                      Worth <Money cents={s.valueCents} />
                      {s.proceedsCents > 0 ? (
                        <>
                          {' '}
                          + sold or spent <Money cents={s.proceedsCents} />
                        </>
                      ) : null}
                      {s.recoveredCents > 0 ? (
                        <>
                          {' '}
                          + paid back <Money cents={s.recoveredCents} />
                        </>
                      ) : null}{' '}
                      − cost of every purchase <Money cents={s.purchasesCostCents} /> − interest {s.interestOnPurchasesEstimated ? <Approx /> : null}
                      <Money cents={s.interestOnPurchasesCents} />
                    </>
                  ),
                },
              ]
            : []),
        ];

  return (
    <Card as="section" aria-label="Details" className="flex flex-col pb-2 lg:pb-2.5">
      <h2 className="m-0 mb-1 text-[15px] font-semibold">Details</h2>
      <Group title="The loan" facts={theLoan} />
      <Group title="Interest" facts={interest} />
      <Group title="The Bitcoin" facts={bitcoin} />
    </Card>
  );
}
