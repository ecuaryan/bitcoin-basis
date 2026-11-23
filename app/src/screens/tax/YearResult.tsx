import { useId, useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { countOf } from '../../lib/format.ts';
import { TERM_HELP } from '../../lib/terms.ts';
import { Money } from '../../ui/Amount.tsx';
import { useHelp } from '../../ui/Help.tsx';
import { ChevronDownIcon } from '../../ui/more-icons.tsx';
import { yearVerdict, type KindTotals, type YearTaxView } from './tax-logic.ts';

type Totals = { sales: KindTotals; spending: KindTotals; fees: KindTotals; other: KindTotals };

/** Dollars with a sign, green for a gain and red for a loss ($0.00 plain). */
function Signed({ cents, className }: { cents: number; className?: string }) {
  return (
    <span className={cx(cents > 0 ? 'text-gain' : cents < 0 ? 'text-loss' : undefined, className)}>
      <Money cents={cents} signed />
    </span>
  );
}

/** One labeled figure: a small label, the value, and a line under it. */
function Tile({ label, children, sub }: { label: string; children: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 flex flex-col gap-1">
        <span className="text-base font-semibold leading-snug">{children}</span>
        <span className="text-xs leading-snug text-muted">{sub}</span>
      </dd>
    </div>
  );
}

/** What the result means, in a sentence or two, with the engine's figures. */
function Verdict({ year, view, disposals }: { year: number; view: YearTaxView; disposals: number }) {
  const v = yearVerdict(view, disposals);
  let title: ReactNode;
  let body: ReactNode;
  if (v.kind === 'gain') {
    title = (
      <>
        Taxed on <Money cents={v.netCents} /> of gains
      </>
    );
    const short = v.shortCents > 0 ? <><Money cents={v.shortCents} /> short-term, taxed like wages</> : null;
    const long = v.longCents > 0 ? <><Money cents={v.longCents} /> long-term, taxed at a lower rate</> : null;
    body = (
      <>
        {short}
        {short && long ? ', and ' : null}
        {long}.
      </>
    );
  } else if (v.kind === 'loss') {
    title = `No tax on Bitcoin gains for ${year}`;
    body =
      v.deductionCents > 0 || v.carryCents > 0 ? (
        <>
          {v.deductionCents > 0 ? (
            <>
              <Money cents={v.deductionCents} /> lowers your other income.
            </>
          ) : null}
          {v.deductionCents > 0 && v.carryCents > 0 ? ' ' : null}
          {v.carryCents > 0 ? (
            <>
              <Money cents={v.carryCents} /> carries into {year + 1}.
            </>
          ) : null}
        </>
      ) : null;
  } else if (v.kind === 'even') {
    title = `No net gain or loss for ${year}`;
    body = 'Your gains and losses cancel out.';
  } else {
    title = `No sales or spending in ${year}`;
    body = 'So there are no gains or losses to report.';
  }
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-bg px-3.5 py-3">
      <span className="text-sm font-semibold">{title}</span>
      {body ? <span className="text-xs leading-normal text-soft">{body}</span> : null}
    </div>
  );
}

/** Tax season: the year's capital gains in one card, the result first, then how it was reached. */
export function YearResult({ year, view, totals }: { year: number; view: YearTaxView; totals: Totals }) {
  const help = useHelp('What are short-term and long-term?', TERM_HELP);
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const carried = view.carriedIn.st + view.carriedIn.lt;
  const disposals = totals.sales.count + totals.spending.count + totals.fees.count + totals.other.count;
  const kinds = [
    { label: 'Sales', t: totals.sales, count: countOf(totals.sales.count, 'sale') },
    { label: 'Spending', t: totals.spending, count: `${countOf(totals.spending.count, 'purchase')} paid in Bitcoin` },
    { label: 'Network fees', t: totals.fees, count: countOf(totals.fees.count, 'tiny sale') },
    { label: 'Frozen platform loss or payout', t: totals.other, count: countOf(totals.other.count, 'entry', 'entries') },
  ].filter((k) => k.t.count > 0);
  return (
    <section aria-label={`Your ${year} result`} className="flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="m-0 font-display text-[19px] font-semibold tracking-[-0.01em]">Your {year} result</h2>
          {help.button}
        </div>
        {help.panel}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Net gain or loss{carried > 0 ? ', after losses from past years' : ''}</span>
        <span className="font-display text-[34px] font-semibold leading-none tracking-[-0.02em] lg:text-[44px]">
          <Signed cents={view.netting.net} />
        </span>
        <span className="text-xs leading-normal text-muted">
          {carried > 0 ? (
            <>
              This year{' '}
              <span className="text-soft">
                <Money cents={view.stCents + view.ltCents} signed />
              </span>{' '}
              − losses from past years{' '}
              <span className="text-soft">
                <Money cents={carried} />
              </span>
            </>
          ) : (
            'No losses from past years to use.'
          )}
        </span>
      </div>
      <Verdict year={year} view={view} disposals={disposals} />
      <dl className="m-0 grid grid-cols-2 gap-x-3.5 gap-y-4">
        <Tile label="Short-term" sub="This year · taxed like wages">
          <Signed cents={view.stCents} />
        </Tile>
        <Tile label="Long-term" sub="This year · lower tax rate">
          <Signed cents={view.ltCents} />
        </Tile>
        <Tile
          label="Used against other income"
          sub={
            <>
              Up to <Money cents={view.limitCents} /> a year
            </>
          }
        >
          <Money cents={view.netting.lossDeduction} />
        </Tile>
        <Tile label={`Losses left for ${year + 1}`} sub="Carried forward">
          <Money cents={view.carryOut.st + view.carryOut.lt} />
        </Tile>
      </dl>
      <div className="flex flex-col border-t border-line pt-3">
        <h3 className="m-0 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">What happened in {year}</h3>
        {kinds.length === 0 ? (
          <p className="m-0 py-2 text-sm text-muted">No sales or spending this year.</p>
        ) : (
          <ul aria-label={`What happened in ${year}`} className="m-0 list-none p-0">
            {kinds.map(({ label, t, count }) => {
              const fee = t === totals.fees && t.proceedsCents > 0;
              return (
                <li key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-line-soft py-2.5">
                  <span className="text-sm">{label}</span>
                  <span className="text-right text-sm font-semibold">
                    {fee ? (
                      <>
                        worth <Money cents={t.proceedsCents} />
                      </>
                    ) : (
                      <Signed cents={t.gainCents} />
                    )}
                  </span>
                  <span className="text-xs text-muted">{count}</span>
                  <span className="text-right text-xs text-muted">
                    {fee && t.gainCents !== 0 ? (
                      <>
                        gain <Money cents={t.gainCents} signed />
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 items-center gap-1.5 bg-transparent p-0 text-left text-sm font-semibold text-soft hover:text-text"
        >
          How it nets out, for Schedule D
          <ChevronDownIcon size={14} className={cx('text-muted transition-transform', open && 'rotate-180')} />
        </button>
        {open ? (
          <section id={detailsId} aria-label="After losses from past years" className="mb-1 flex flex-col gap-2 rounded-xl bg-bg px-3.5 py-3 text-[13px]">
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
              <dt className="text-soft">Losses from past years</dt>
              <dd className="m-0 text-right font-semibold">
                <Money cents={carried} />
              </dd>
              <dt className="text-soft">Short-term after past losses</dt>
              <dd className="m-0 text-right font-semibold">
                <Signed cents={view.netting.st} />
              </dd>
              <dt className="text-soft">Long-term after past losses</dt>
              <dd className="m-0 text-right font-semibold">
                <Signed cents={view.netting.lt} />
              </dd>
            </dl>
            <p className="m-0 text-xs leading-normal text-muted">Past short-term losses come off short-term first and past long-term losses off long-term; then the two are combined.</p>
          </section>
        ) : null}
      </div>
    </section>
  );
}
