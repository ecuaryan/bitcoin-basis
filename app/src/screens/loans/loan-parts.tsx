import { loanSummary, type LoanSummary } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { shortDate } from '../../lib/format.ts';
import { breakEvenWords, loanNudgeSnoozed, paymentNudge, snoozeLoanNudge } from '../../lib/loans-view.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { useHelp } from '../../ui/Help.tsx';
import { ChevronRightIcon } from '../../ui/icons.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { SectionHeader } from '../../ui/SectionHeader.tsx';
import { usePrefs } from '../../ui/prefs.tsx';

/** What the "≈" means, for the "?" next to loan figures. */
export const LOAN_ESTIMATE_HELP =
  '≈ marks an estimate. Interest you have not paid yet (since your last payment, or left over from a statement paid in part) is worked out from your rate, and each purchase’s share of the interest is split by how long its money was borrowed. Everything else comes from what you entered.';

/** The break-even label everywhere, and what its "?" says. */
export const BREAK_EVEN_LABEL = 'Break-even price (with interest paid so far)';
export const BREAK_EVEN_HELP =
  'Uses the Bitcoin from this loan’s purchases that you still hold: the price at which it would cover what it cost plus the interest you have paid so far. Interest not billed or paid yet is not included until you pay it.';

/** What the "?" beside "If you paid it off today" says. */
export const PAYOFF_HELP =
  'Uses the Bitcoin from this loan’s purchases that you still hold, at today’s price, against what you owe now: the balance plus interest not paid yet, billed or not (an estimate, marked ≈).';

/** A quiet "≈" before an estimated figure (read as "about"). */
export function Approx() {
  return (
    <>
      <span aria-hidden="true" className="text-muted">
        ≈{' '}
      </span>
      <span className="sr-only">about </span>
    </>
  );
}

/**
 * What "Owed now" adds to the balance, each part labeled: interest billed for days a payment covered but left unpaid,
 * and interest since the last day paid (billed by a statement that closed since, or not billed yet).
 */
export function OwedNowParts({ s, today }: { s: Pick<LoanSummary, 'unpaidBilledInterestCents' | 'accruedInterestCents' | 'accruedFrom' | 'accruedBilledThrough'>; today: string }) {
  const unpaid = s.unpaidBilledInterestCents > 0;
  const accrued = s.accruedInterestCents > 0;
  return (
    <>
      Includes{' '}
      {unpaid ? (
        <>
          about <Money cents={s.unpaidBilledInterestCents} /> interest billed but not yet paid
        </>
      ) : null}
      {unpaid && accrued ? ' and ' : null}
      {accrued ? (
        <>
          about <Money cents={s.accruedInterestCents} /> {unpaid ? '' : 'interest '}since {shortDate(s.accruedFrom ?? today)},{' '}
          {s.accruedBilledThrough === null ? 'not billed yet' : `not paid yet (statement closed ${shortDate(s.accruedBilledThrough)})`}
        </>
      ) : null}
    </>
  );
}

/** The small word on a purchase paid with a loan (`HELOC`). */
export function LoanBadge({ tag, className }: { tag: string; className?: string }) {
  return <span className={cx('flex-none rounded-md border border-line px-1.5 text-[11px] font-semibold leading-4 text-soft', className)}>{tag}</span>;
}

/** Dollars with a sign and the gain or loss color. `plain` inside links and buttons. */
export function SignedMoney({ cents, plain = false, precision = 'dollars', className }: { cents: number; plain?: boolean; precision?: 'dollars' | 'cents'; className?: string }) {
  const tone = cents < 0 ? 'text-loss' : 'text-accent';
  return <span className={cx(tone, className)}>{plain ? <PlainMoney cents={cents} precision={precision} signed /> : <Money cents={cents} precision={precision} signed />}</span>;
}

/** The loan figures every view shares, as plain lines. Values come straight from the engine's summary. */
export function loanLines(s: LoanSummary, plain: boolean, masked: boolean): { key: string; node: ReactNode }[] {
  // Cents, as on the loan page: Owed and Available add up to the credit limit exactly, and the break-even is never cut short.
  const M = ({ cents }: { cents: number }) => (plain ? <PlainMoney cents={cents} /> : <Money cents={cents} />);
  const lines: { key: string; node: ReactNode }[] = [];
  lines.push({
    key: 'owed',
    node: (
      <>
        Owed <M cents={s.principalOwedCents} />
        {s.availableCreditCents !== null ? (
          <>
            {' '}
            · {s.availableCreditCents < 0 ? 'Over the limit by ' : 'Available '}
            <M cents={Math.abs(s.availableCreditCents)} />
          </>
        ) : null}
      </>
    ),
  });
  if (s.purchaseCount > 0) {
    const allHeld = s.frozenSats === 0 && s.soldSats === 0 && s.otherGoneSats === 0;
    lines.push({
      key: 'bought',
      node: (
        <>
          {allHeld ? 'Bought ' : 'Still held '}
          <Amount sats={s.heldSats} short showUnit interactive={false} />
          {s.valueCents !== null ? (
            <>
              {' '}
              · worth <M cents={s.valueCents} />
            </>
          ) : null}
        </>
      ),
    });
  }
  lines.push({
    key: 'interest',
    node: (
      <>
        Interest paid <M cents={s.interestPaidCents} />
      </>
    ),
  });
  if (s.breakEvenPriceCents !== null) {
    const words = breakEvenWords(s.priceCents, s.breakEvenPriceCents, masked);
    lines.push({
      key: 'break-even',
      node: (
        <>
          {BREAK_EVEN_LABEL} {s.interestOnPurchasesEstimated ? <Approx /> : null}
          <M cents={s.breakEvenPriceCents} />
          {words !== null ? <span className="text-muted"> · {words}</span> : null}
        </>
      ),
    });
  }
  if (s.payoffLeftoverSats !== null && s.heldSats > 0) {
    const left = s.payoffLeftoverSats;
    lines.push({
      key: 'payoff',
      node: (
        <>
          If you paid it off today: {s.owedNowEstimated ? <Approx /> : null}
          {left === 0 ? (
            'just enough'
          ) : (
            <>
              <Amount sats={Math.abs(left)} short showUnit interactive={false} />
              <span className={left < 0 ? 'text-loss' : 'text-accent'}>{left < 0 ? ' short' : ' left over'}</span>
            </>
          )}
        </>
      ),
    });
  }
  return lines;
}

/** "Including interest": the big honest number (value − cost of the coins still held − interest on them). */
export function IncludingInterest({ s, plain, size = 'card' }: { s: LoanSummary; plain: boolean; size?: 'card' | 'page' }) {
  const cents = s.gainIncludingInterestCents;
  return (
    <span className="flex flex-col gap-1">
      <span className={cx('text-muted', size === 'page' ? 'text-[13px]' : 'text-xs')}>Including interest</span>
      <span className={cx('font-display font-semibold leading-none tracking-[-0.02em]', size === 'page' ? 'text-[34px] lg:text-5xl' : 'text-[28px]')}>
        {cents === null ? (
          '—'
        ) : (
          <>
            {s.interestOnPurchasesEstimated ? <Approx /> : null}
            <SignedMoney cents={cents} plain={plain} />
          </>
        )}
      </span>
    </span>
  );
}

/** Every open loan's summary today at the live price, oldest first. */
export function useLoanSummaries(): LoanSummary[] {
  const { state, today } = useLedger();
  const { quote } = usePrice();
  const price = quote?.usdCents ?? null;
  return useMemo(() => state.loans.filter((l) => !l.closed).flatMap((l) => loanSummary(state, l.id, price, today) ?? []), [state, today, price]);
}

/** One loan on Holdings: the whole block opens the loan page. */
function LoanBlock({ s }: { s: LoanSummary }) {
  const { masked } = usePrefs();
  const lines = loanLines(s, true, masked);
  return (
    <Link
      to={`/loans/${s.loanId}`}
      className="press-soft flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3.5 text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:items-center lg:gap-6 lg:p-5"
    >
      <span className="flex flex-col gap-3">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">{s.name}</span>
          <ChevronRightIcon size={16} className="flex-none text-muted lg:hidden" />
        </span>
        <IncludingInterest s={s} plain />
        {s.purchaseCount === 0 ? <span className="text-xs text-muted">No purchases linked yet. Open it to add them.</span> : null}
      </span>
      <span className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] leading-snug text-soft">
          {lines.map((l) => (
            <span key={l.key}>{l.node}</span>
          ))}
        </span>
        <ChevronRightIcon size={16} className="hidden flex-none text-muted lg:block" />
      </span>
    </Link>
  );
}

/** Holdings: one block per open loan. Nothing at all when there is no loan. */
export function LoansSection({ className }: { className?: string }) {
  const loans = useLoanSummaries();
  const help = useHelp('What does ≈ mean?', LOAN_ESTIMATE_HELP);
  if (loans.length === 0) return null;
  return (
    <section aria-label="Loans" className={cx('flex flex-col gap-2', className)}>
      <SectionHeader title="Loans" help={help.button} className="px-0.5" />
      {help.panel ? <div className="-mt-1 px-0.5">{help.panel}</div> : null}
      <div className="flex flex-col gap-2">
        {loans.map((s) => (
          <LoanBlock key={s.loanId} s={s} />
        ))}
      </div>
    </section>
  );
}

/** Once a statement has closed and no payment is logged for it: one calm reminder. Not now waits for the next one. */
export function LoanNudge() {
  const { state, today } = useLedger();
  const nudge = useMemo(() => paymentNudge(state, today), [state, today]);
  const [snoozed, setSnoozed] = useState<string | null>(null);
  if (nudge === null || snoozed === nudge.cycleEnd || loanNudgeSnoozed(nudge.cycleEnd)) return null;
  return (
    <section aria-label="Loan payment reminder" className="flex w-full items-center gap-1 rounded-2xl border border-line bg-surface pl-3.5 lg:max-w-[640px]">
      <Link to={`/loans/${nudge.loanId}?pay=1`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 text-text no-underline hover:text-text">
        <span className="flex items-center gap-1 text-sm font-semibold">
          Log your {nudge.name} payment
          <ChevronRightIcon size={14} className="flex-none text-muted" />
        </span>
        <span className="text-xs text-muted">
          Statement closed {shortDate(nudge.cycleEnd)} · about <PlainMoney cents={nudge.interestCents} /> interest
        </span>
      </Link>
      <button
        type="button"
        onClick={() => {
          snoozeLoanNudge(nudge.cycleEnd);
          setSnoozed(nudge.cycleEnd);
        }}
        className="min-h-11 flex-none bg-transparent px-3.5 text-xs font-semibold text-muted hover:text-text"
      >
        Not now
      </button>
    </section>
  );
}
