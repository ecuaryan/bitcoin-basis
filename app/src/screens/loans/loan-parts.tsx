import { formatAprPercent, loanSummary, type LoanSummary } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { formatMoney, shortDate } from '../../lib/format.ts';
import { breakEvenWords, gaugeLeft, loanNudgeSnoozed, paymentNudge, snoozeLoanNudge } from '../../lib/loans-view.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { useHelp } from '../../ui/Help.tsx';
import { ChevronRightIcon } from '../../ui/icons.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { SectionHeader } from '../../ui/SectionHeader.tsx';
import { usePrefs } from '../../ui/prefs.tsx';

/** What the "≈" means, for the "?" next to loan figures. */
export const LOAN_ESTIMATE_HELP =
  '≈ marks an estimate. Interest you have not paid yet (since your last payment, or left over from a statement paid in part) is worked out from your rate, and each purchase’s share of the interest is split by how long its money was borrowed. Everything else comes from what you entered.';

/** What the break-even's "?" says. */
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
  const tone = cents < 0 ? 'text-loss' : 'text-gain';
  return <span className={cx(tone, className)}>{plain ? <PlainMoney cents={cents} precision={precision} signed /> : <Money cents={cents} precision={precision} signed />}</span>;
}

/** The big honest number's name, on the card and the loan page. */
export const GAIN_AFTER_INTEREST = 'Gain or loss after interest';

/**
 * The big number in cents, signed and in the gain or loss color, the cents a size smaller (`−$13,662` `.16`). Cents on
 * the card and the loan page alike, so the hero is exactly the purchases table's Total. `plain` inside links.
 */
export function HeroMoney({ cents, plain }: { cents: number; plain: boolean }) {
  const { masked } = usePrefs();
  if (masked) return <SignedMoney cents={cents} plain={plain} precision="cents" />;
  const text = formatMoney(cents, { signed: true });
  const dot = text.lastIndexOf('.');
  return (
    <span className={cx('whitespace-nowrap tabular-nums', cents < 0 ? 'text-loss' : 'text-gain')}>
      {text.slice(0, dot)}
      <span className="text-[0.62em]">{text.slice(dot)}</span>
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

/** A "?" and what it opens (from `useHelp`). */
type HelpParts = { button: ReactNode; panel: ReactNode };

/** One labeled figure on the loan card: a small label (and its "?" on the loan page), the value, and an optional line under it. */
function Tile({ label, help, children, sub }: { label: string; help?: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-1 @min-[40rem]:px-5 @min-[40rem]:first:pl-0 @min-[40rem]:last:pr-0">
      <span className="flex items-center gap-1 text-xs text-muted">
        {label}
        {help}
      </span>
      <span className="text-base font-semibold leading-snug @min-[40rem]:text-lg">{children}</span>
      {sub ? <span className="text-xs leading-snug text-muted">{sub}</span> : null}
    </span>
  );
}

/** Price against break-even: break-even is the mark in the middle, the dot is today’s price (red below, green above). */
function BreakEvenGauge({ s, breakEven, masked, help }: { s: LoanSummary; breakEven: number; masked: boolean; help?: ReactNode }) {
  const price = s.priceCents;
  const words = breakEvenWords(price, breakEven, masked);
  const short = breakEvenWords(price, breakEven, masked, true);
  const tone = price === null || price === breakEven ? 'text-soft' : price < breakEven ? 'text-loss' : 'text-gain';
  const dot = price === null || price === breakEven ? 'bg-soft' : price < breakEven ? 'bg-loss' : 'bg-gain';
  return (
    <span className="flex flex-col gap-2.5 rounded-2xl bg-bg px-3 pb-2.5 pt-3 @min-[40rem]:px-4 @min-[40rem]:pt-4">
      <span className="flex items-baseline justify-between gap-2 text-xs @min-[40rem]:text-[13px]">
        <span className="flex items-center gap-1 text-muted">
          <span>
            Break-even{' '}
            <span className="font-semibold text-text">
              {s.interestOnPurchasesEstimated ? <Approx /> : null}
              <PlainMoney cents={breakEven} />
            </span>
          </span>
          {help}
        </span>
        {short !== null ? (
          <span className={cx('flex-none font-semibold', tone)}>
            <span aria-hidden="true">{short}</span>
            <span className="sr-only">. {words}</span>
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="relative block h-6">
        <span className="absolute left-0 right-1/2 top-[9px] h-1.5 rounded-l-full bg-loss/30" />
        <span className="absolute left-1/2 right-0 top-[9px] h-1.5 rounded-r-full bg-gain/30" />
        <span className="absolute left-1/2 top-1 -ml-px h-4 w-0.5 rounded-sm bg-text" />
        {price === null || masked ? null : (
          <span data-testid="gauge-dot" className={cx('absolute top-[5px] -ml-[7px] size-3.5 rounded-full ring-[3px] ring-bg', dot)} style={{ left: `${gaugeLeft(price, breakEven)}%` }} />
        )}
      </span>
      <span className="-mt-1.5 flex justify-between gap-2 text-[11px] text-muted @min-[40rem]:text-xs">
        <span>
          {price === null ? null : (
            <>
              Price now{' '}
              <span className="font-semibold text-text">
                <PlainMoney cents={price} precision="dollars" />
              </span>
            </>
          )}
        </span>
        <span>Includes interest paid so far</span>
      </span>
    </span>
  );
}

/** The loan page's additions to the top half: its "?"s (the card is one link, so it has none) and a line under the math. */
export interface LoanTopExtras {
  estimate: HelpParts;
  breakEven: HelpParts;
  payoff: HelpParts;
  /** Under the hero's math (the whole result, once some coins have left). */
  note?: ReactNode;
}

/**
 * The top half of a loan, the same on the Holdings card and the loan page: the result after interest with its math, price
 * against break-even, and four labeled figures. Put it in a container (`@container`): wide from 40rem of it.
 */
export function LoanTop({ s, extras }: { s: LoanSummary; extras?: LoanTopExtras }) {
  const { masked } = usePrefs();
  const plain = extras === undefined;
  const bought = s.purchaseCount > 0;
  const allHeld = s.frozenSats === 0 && s.soldSats === 0 && s.otherGoneSats === 0;
  const unpaid = s.owedNowCents - s.principalOwedCents;
  const limit = s.creditLimitCents;
  const available = s.availableCreditCents;
  const left = s.payoffLeftoverSats;
  const used = limit === null || available === null || limit <= 0 ? null : Math.min(100, Math.max(0, ((limit - available) / limit) * 100));
  return (
    <>
      {bought ? (
        <span className="flex flex-col gap-4 @min-[40rem]:grid @min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] @min-[40rem]:items-center @min-[40rem]:gap-8">
          <span className="flex flex-col gap-1.5 @min-[40rem]:gap-2">
            <span className="flex items-center gap-1 text-xs text-muted @min-[40rem]:text-[13px]">
              {GAIN_AFTER_INTEREST}
              {extras?.estimate.button}
            </span>
            <span className="font-display text-[34px] font-semibold leading-none tracking-[-0.02em] @min-[40rem]:text-5xl">
              {s.gainIncludingInterestCents === null ? (
                '—'
              ) : (
                <>
                  {s.interestOnPurchasesEstimated ? <Approx /> : null}
                  <HeroMoney cents={s.gainIncludingInterestCents} plain={plain} />
                </>
              )}
            </span>
            {s.valueCents === null ? null : (
              <span className="text-xs leading-normal text-muted @min-[40rem]:text-[13px]">
                Worth{' '}
                <span className="text-soft">
                  <PlainMoney cents={s.valueCents} />
                </span>{' '}
                − cost{' '}
                <span className="text-soft">
                  <PlainMoney cents={s.heldCostCents} />
                </span>{' '}
                − interest{' '}
                <span className="text-soft">
                  {s.interestOnPurchasesEstimated ? <Approx /> : null}
                  <PlainMoney cents={s.interestOnPurchasesCents} />
                </span>
              </span>
            )}
            {extras?.note ? <span className="text-xs leading-normal text-muted @min-[40rem]:text-[13px]">{extras.note}</span> : null}
          </span>
          {s.breakEvenPriceCents === null ? null : <BreakEvenGauge s={s} breakEven={s.breakEvenPriceCents} masked={masked} help={extras?.breakEven.button} />}
        </span>
      ) : (
        <span className="text-[13px] text-muted">{plain ? 'No purchases linked yet. Open it to add them.' : 'No purchases linked yet. Add them below.'}</span>
      )}
      {extras?.estimate.panel}
      {extras?.breakEven.panel}
      <span className="grid grid-cols-2 gap-x-3.5 gap-y-4 @min-[40rem]:grid-cols-4 @min-[40rem]:gap-0 @min-[40rem]:divide-x @min-[40rem]:divide-line @min-[40rem]:border-t @min-[40rem]:border-line @min-[40rem]:pt-4">
        <Tile
          label="Owed"
          sub={
            available === null || limit === null ? null : (
              <>
                {used === null ? null : (
                  <span aria-hidden="true" className="mb-1.5 mt-0.5 block h-1 overflow-hidden rounded-full bg-line">
                    <span className={cx('block h-1 rounded-full', available < 0 ? 'bg-loss' : 'bg-accent')} style={{ width: `${used}%` }} />
                  </span>
                )}
                {available < 0 ? (
                  <span className="text-loss">
                    Over the limit by <PlainMoney cents={-available} />
                  </span>
                ) : (
                  <>
                    <PlainMoney cents={available} /> available of <PlainMoney cents={limit} />
                  </>
                )}
              </>
            )
          }
        >
          <PlainMoney cents={s.principalOwedCents} />
        </Tile>
        {bought ? (
          <Tile label={allHeld ? 'Bitcoin it bought' : 'Bitcoin still held'} sub={allHeld ? 'All still held' : <>Of <Amount sats={s.boughtSats} short showUnit interactive={false} /> bought</>}>
            <Amount sats={s.heldSats} short showUnit interactive={false} />
          </Tile>
        ) : null}
        <Tile
          label="Interest paid"
          sub={
            unpaid > 0 ? (
              <>
                <Approx />
                <PlainMoney cents={unpaid} /> not paid yet
              </>
            ) : null
          }
        >
          <PlainMoney cents={s.interestPaidCents} />
        </Tile>
        {left !== null && s.heldSats > 0 ? (
          <Tile
            label="If paid off today"
            help={extras?.payoff.button}
            sub={
              <>
                {left > 0 ? 'Left over after paying ' : left < 0 ? 'Short of the ' : 'Exactly covers '}
                {s.owedNowEstimated ? <Approx /> : null}
                <PlainMoney cents={s.owedNowCents} />
                {left > 0 ? '' : ' owed'}
              </>
            }
          >
            {left === 0 ? 'Just enough' : <PayoffSats sats={left} estimated={s.owedNowEstimated} />}
          </Tile>
        ) : null}
      </span>
      {extras?.payoff.panel}
    </>
  );
}

/**
 * What paying it off today leaves (positive) or lacks (negative), never better than it is: a shortfall rounds up and a
 * leftover down at 4 decimals (or to the cent in USD; sats are exact), so a shortfall is never shown smaller and a
 * leftover never bigger.
 */
export function PayoffSats({ sats, estimated }: { sats: number; estimated: boolean }) {
  return (
    <span className={sats < 0 ? 'text-loss' : 'text-gain'}>
      {estimated ? <Approx /> : null}
      <Amount sats={Math.abs(sats)} short showUnit interactive={false} round={sats < 0 ? 'up' : 'down'} />
      <span className="sr-only">{sats < 0 ? ' short' : ' left over'}</span>
    </span>
  );
}

/** One loan on Holdings: its name and rate over `LoanTop`. The whole card opens the loan page. */
function LoanBlock({ s }: { s: LoanSummary }) {
  return (
    <Link
      to={`/loans/${s.loanId}`}
      className="press-soft @container flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2 lg:gap-5 lg:px-6 lg:py-5"
    >
      <span className="flex items-center gap-2">
        <span className="truncate text-[15px] font-semibold @min-[40rem]:text-base">{s.name}</span>
        <span className="flex-none rounded-md border border-line px-1.5 text-[11px] font-semibold leading-5 text-soft">{formatAprPercent(s.aprMillionths)} APR</span>
        <span className="ml-auto flex flex-none items-center gap-1 text-[13px] font-semibold text-soft">
          <span className="hidden @min-[40rem]:inline">Open loan</span>
          <ChevronRightIcon size={16} className="text-muted" />
        </span>
      </span>
      <LoanTop s={s} />
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
