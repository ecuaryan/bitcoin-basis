import { isValidLocalDate, loanPurchases, loanSummary, parseDollars, type Loan, type LoanSummary } from '@bitcoin-basis/engine';
import { BackLink } from '../../ui/BackLink.tsx';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { buildItems, type EntryItem, type EntryRun } from '../../lib/entry-list.ts';
import { countOf, shortDate } from '../../lib/format.ts';
import { recordedBalanceOn, statementDayText, statementToCheck } from '../../lib/loans-view.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { HideButton, LockButton, useIsWide } from '../../ui/AppShell.tsx';
import { Button, buttonClasses } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Callout, TextField } from '../../ui/form-fields.tsx';
import { MoneyInput } from '../../ui/formatted-inputs.tsx';
import { useHelp } from '../../ui/Help.tsx';
import { ChevronRightIcon, PlusIcon } from '../../ui/icons.tsx';
import { ChevronLeftIcon, PencilIcon } from '../../ui/more-icons.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { EmptyLine, SectionCount, SectionHeader, ShowMore } from '../../ui/SectionHeader.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useSubmit } from '../../ui/use-submit.ts';
import { useTitle } from '../../ui/use-title.ts';
import { EntrySheet } from '../entry-parts.tsx';
import { cleanNumber } from '../log/model.ts';
import { Details } from './loan-details.tsx';
import { BREAK_EVEN_HELP, LOAN_ESTIMATE_HELP, LoanTop, PAYOFF_HELP, SignedMoney } from './loan-parts.tsx';
import { Purchases } from './loan-purchases.tsx';
import { CloseLoanSheet, LoanSettingsSheet, PaymentSheet, RateSheet, useReopen } from './loan-sheets.tsx';
import { ManagePurchasesSheet } from './LoanSetup.tsx';
import { useLoanWriter } from './loan-writer.ts';

const ROUND_BTN = 'press flex size-11 flex-none items-center justify-center rounded-xl border border-line bg-surface text-soft hover:text-text';

type SheetName = 'pay' | 'rate' | 'settings' | 'close' | 'purchases';

/** Label and value rows on a dark well, as on an entry's details. */
type Row = { k: string; v: ReactNode; sub?: ReactNode; help?: { button: ReactNode; panel: ReactNode } };

function Rows({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <dl aria-label={label} className="m-0 flex flex-col rounded-2xl border border-line bg-bg px-4 py-1">
      {rows.map((r, i) => (
        <div key={r.k} className={cx('flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2.5 text-sm', i < rows.length - 1 && 'border-b border-line')}>
          <dt className="text-soft">
            {r.k}
            {r.help ? <span className="ml-1.5 inline-flex align-middle">{r.help.button}</span> : null}
          </dt>
          <dd className="m-0 ml-auto text-right font-semibold">
            {r.v}
            {r.sub ? <span className="mt-0.5 block text-xs font-normal text-muted">{r.sub}</span> : null}
          </dd>
          {r.help?.panel ? <dd className="m-0 basis-full pt-1.5 text-left">{r.help.panel}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

const runOf = (item: EntryItem): EntryRun => ({ item, count: 1, items: [item], net: null });

// ---- Where it stands -------------------------------------------------------------------------

/** The top of the page: the Holdings card's top half (`LoanTop`), with its "?"s and, once coins have left, the whole result. */
function Standing({ s }: { s: LoanSummary }) {
  const estimate = useHelp('What does ≈ mean?', LOAN_ESTIMATE_HELP);
  const breakEven = useHelp('What is in the break-even price?', BREAK_EVEN_HELP);
  const payoff = useHelp('What does paying it off today use?', PAYOFF_HELP);
  const whole = s.overallResultCents !== null && (s.proceedsCents > 0 || s.recoveredCents > 0) ? s.overallResultCents : null;
  const note =
    whole === null ? undefined : (
      <>
        Counts the <Amount sats={s.heldSats} short showUnit interactive={false} /> still held. With what already left, the whole result is{' '}
        <SignedMoney cents={whole} precision="cents" className="font-semibold" />.
      </>
    );
  return (
    <Card as="section" aria-label="Where it stands" className="@container flex flex-col gap-4 lg:gap-5 lg:px-6 lg:py-5">
      <LoanTop s={s} extras={{ estimate, breakEven, payoff, note }} />
    </Card>
  );
}

// ---- Payments ---------------------------------------------------------------------------------

function Payments({ loan, onPay, onOpen }: { loan: Loan; onPay(): void; onOpen(item: EntryItem): void }) {
  const { entries } = useLedger();
  const [all, setAll] = useState(false);
  const items = useMemo(() => new Map(buildItems(entries).map((i) => [i.current.id, i])), [entries]);
  const list = useMemo(() => [...loan.payments].sort((a, b) => (a.date === b.date ? (a.entryId < b.entryId ? 1 : -1) : a.date < b.date ? 1 : -1)), [loan.payments]);
  const shown = all ? list : list.slice(0, 4);
  return (
    <Card as="section" aria-label="Payments" className="flex flex-col">
      <SectionHeader title="Payments" right={<SectionCount>{countOf(list.length, 'payment')}</SectionCount>} className="-mt-2" />
      {!loan.closed ? (
        <Button variant="primary" onClick={onPay} className="mb-1 mt-1 w-full sm:w-auto sm:self-start">
          <PlusIcon size={16} />
          Log a payment
        </Button>
      ) : null}
      {list.length === 0 ? <EmptyLine>No payments logged yet.</EmptyLine> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((p, i) => (
          <li key={p.entryId} className={cx(i < shown.length - 1 && 'border-b border-line')}>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                const item = items.get(p.entryId);
                if (item) onOpen(item);
              }}
              className="flex min-h-[56px] w-full items-center gap-3 bg-transparent py-2 text-left text-text"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-3 text-sm font-semibold">
                  <span>{shortDate(p.date)}</span>
                  <PlainMoney cents={p.interestCents + p.principalCents} />
                </span>
                <span className="text-xs text-muted">
                  Interest <PlainMoney cents={p.interestCents} />
                  {p.principalCents > 0 ? (
                    <>
                      {' '}
                      · paid down <PlainMoney cents={p.principalCents} />
                    </>
                  ) : null}
                  {p.principalCents === 0 && p.interestCents > 0 ? ` · through ${shortDate(p.interestThrough)}` : ''}
                </span>
              </span>
              <ChevronRightIcon size={16} className="flex-none text-muted" />
            </button>
          </li>
        ))}
      </ul>
      {list.length > shown.length ? <ShowMore onClick={() => setAll(true)}>Show all {countOf(list.length, 'payment')}</ShowMore> : null}
    </Card>
  );
}

// ---- Statement check ---------------------------------------------------------------------------

function StatementCheck({ loan, s, onPay }: { loan: Loan; s: LoanSummary; onPay(): void }) {
  const { state, today } = useLedger();
  const toast = useToast();
  const writer = useLoanWriter();
  const ask = useMemo(() => statementToCheck(state, loan, today), [state, loan, today]);
  const [different, setDifferent] = useState(false);
  const [text, setText] = useState('');
  const [date, setDate] = useState(ask.date);
  const [error, setError] = useState<string | null>(null);
  const [gap, setGap] = useState<{ diff: number; date: string; balance: number } | null>(null);
  const last = s.statements.at(-1);
  const lastMatch = [...s.statements].reverse().find((x) => x.matches);

  async function record(date: string, balanceCents: number) {
    const already = s.statements.some((x) => x.date === date && x.balanceCents === balanceCents);
    if (!already) {
      const made = writer.make([{ draft: { kind: 'loan-statement', loan: loan.id, balanceCents }, date }]);
      if (made.problems.length > 0) {
        setError(made.problems.join(' '));
        return;
      }
      await writer.save(made.entries);
    }
    toast.show('Matches your statement.', { success: true });
    setDifferent(false);
    setGap(null);
    setText('');
  }
  const submit = useSubmit(async (what: 'yes' | 'check' | 'draw') => {
    if (what === 'yes') return ask.owedCents < 0 ? undefined : record(ask.date, ask.owedCents);
    if (what === 'draw' && gap !== null) {
      const made = writer.make([
        { draft: { kind: 'loan-draw', loan: loan.id, cents: gap.diff, note: 'Found by a statement check' }, date: gap.date },
        { draft: { kind: 'loan-statement', loan: loan.id, balanceCents: gap.balance }, date: gap.date },
      ]);
      if (made.problems.length > 0) {
        setError(made.problems.join(' '));
        return;
      }
      await writer.save(made.entries);
      toast.show('Draw added. It matches now.', { success: true });
      setDifferent(false);
      setGap(null);
      setText('');
      return;
    }
    setError(null);
    setGap(null);
    const cents = parseDollars(cleanNumber(text));
    if (cents === null) return setError('Enter what your statement shows.');
    if (!isValidLocalDate(date) || date > today) return setError('Pick the statement’s date.');
    // The engine's own figure (a credit is negative), so "Matches" and an added draw agree with its check.
    const recorded = recordedBalanceOn(state, loan.id, date);
    if (cents === recorded) return record(date, cents);
    setGap({ diff: cents - recorded, date, balance: cents });
  });
  const busy = submit.busy;

  return (
    <Card as="section" aria-label="Statement check" className="flex flex-col gap-3">
      <SectionHeader title="Does it match your statement?" right={<SectionCount>{lastMatch ? `Matched ${shortDate(lastMatch.date)}` : 'Not checked yet'}</SectionCount>} className="-my-2" />
      {ask.owedCents < 0 ? (
        <p className="m-0 text-[15px] leading-snug">
          Your records show <strong className="font-semibold"><Money cents={-ask.owedCents} /></strong> more paid than drawn by {shortDate(ask.date)}: nothing owed, and a credit.
        </p>
      ) : (
        <p className="m-0 text-[15px] leading-snug">
          Does your {shortDate(ask.date)} statement show{' '}
          <strong className="font-semibold">
            <Money cents={ask.owedCents} />
          </strong>{' '}
          owed?
        </p>
      )}
      <p className="-mt-1.5 m-0 text-xs leading-snug text-muted">The balance you owe on it, not counting the interest due.</p>
      {!different ? (
        <div className="flex flex-wrap gap-2">
          {ask.owedCents < 0 ? null : (
            <Button variant="secondary" disabled={busy} onClick={() => void submit.run('yes')}>
              {busy ? 'Saving…' : 'Yes'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setDifferent(true)}>
            {ask.owedCents < 0 ? 'Check a statement' : <>No, it&apos;s different</>}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit.run('check');
          }}
        >
          <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-2">
            <MoneyInput
              label="What it shows"
              value={text}
              onChange={(t) => {
                setText(t);
                setGap(null);
              }}
              error={error}
            />
            <TextField label="Statement date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="!px-2" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? 'Saving…' : 'Check'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDifferent(false);
                setGap(null);
                setError(null);
              }}
            >
              Back
            </Button>
          </div>
        </form>
      )}
      {gap !== null ? (
        <div role="status" className="flex flex-col gap-2.5 rounded-2xl border border-amber/40 bg-amber/10 p-3.5 text-[13px] leading-snug">
          <p className="m-0">
            <strong className="font-semibold text-amber">
              Your statement shows <Money cents={Math.abs(gap.diff)} /> {gap.diff > 0 ? 'more' : 'less'} than your records.
            </strong>{' '}
            {gap.diff > 0
              ? 'Money drawn may be missing (taken out for something else), or a payment that lowered it is logged too big.'
              : 'A payment that lowered what you owe may be missing, or part of a payment is logged as interest.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {gap.diff > 0 ? (
              <Button variant="secondary" disabled={busy} onClick={() => void submit.run('draw')}>
                Add a draw of <Money cents={gap.diff} />
              </Button>
            ) : (
              <Button variant="secondary" onClick={onPay}>
                <PlusIcon size={16} />
                Log a payment
              </Button>
            )}
            <Button variant="ghost" onClick={() => setGap(null)}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}
      {gap === null && last !== undefined && !last.matches ? <p className="m-0 text-xs text-amber">The last check did not match.</p> : null}
    </Card>
  );
}

// ---- Settings ----------------------------------------------------------------------------------

function Settings({ loan, onEdit, onClose }: { loan: Loan; onEdit(): void; onClose(): void }) {
  const reopen = useReopen(loan);
  return (
    <Card as="section" aria-label="Loan settings" className="flex flex-col gap-3">
      <SectionHeader title="Settings" className="-my-2" />
      <Rows
        label="Settings"
        rows={[
          { k: 'Name', v: loan.name },
          { k: 'Credit limit', v: loan.creditLimitCents === null ? 'Not set' : <Money cents={loan.creditLimitCents} /> },
          {
            k: 'Statement closing day',
            v: statementDayText(loan.statementDay),
            ...(loan.statementDays.length > 1
              ? { sub: `From ${shortDate((loan.statementDays.at(-1) as { from: string }).from)}. Before that: ${statementDayText((loan.statementDays.at(-2) as { day: number }).day).toLowerCase()}` }
              : {}),
          },
          { k: 'Interest counted on', v: loan.dayCount === 'actual/360' ? '360-day year' : '365-day year' },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onEdit}>
          <PencilIcon size={16} />
          Change settings
        </Button>
        {loan.closed ? (
          <Button variant="secondary" disabled={reopen.busy} onClick={() => void reopen.run()}>
            {reopen.busy ? 'Saving…' : 'Reopen this loan'}
          </Button>
        ) : (
          <Button variant="danger" onClick={onClose}>
            Close this loan
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---- Screen -----------------------------------------------------------------------------------

export function LoanPage() {
  const { id } = useParams();
  const { state, today, ready } = useLedger();
  const { quote } = usePrice();
  const wide = useIsWide();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<SheetName | null>(() => (params.get('pay') === '1' ? 'pay' : null));
  const [entry, setEntry] = useState<EntryItem | null>(null);
  const loan = state.loans.find((l) => l.id === id);
  const price = quote?.usdCents ?? null;
  const s = useMemo(() => (loan ? loanSummary(state, loan.id, price, today) : null), [state, loan, price, today]);
  const purchases = useMemo(() => (loan ? loanPurchases(state, loan.id, price, today) : []), [state, loan, price, today]);
  useTitle(ready ? (loan?.name ?? 'Loan') : null);
  useEffect(() => {
    if (params.get('pay') === '1') setParams({}, { replace: true });
  }, [params, setParams]);

  if (!ready) return <div aria-busy="true" className="min-h-[60dvh]" />;
  if (loan === undefined || s === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-tight lg:text-4xl">Loan</h1>
        <Card>That loan is not in your book.</Card>
        <Link to="/" className={buttonClasses('secondary', 'w-fit no-underline text-text')}>
          Back to Holdings
        </Link>
      </div>
    );
  }
  const close = () => setSheet(null);
  const standing = <Standing s={s} />;
  const details = <Details loan={loan} s={s} purchases={purchases} onRate={() => setSheet('rate')} />;
  const purchaseList = <Purchases loan={loan} s={s} purchases={purchases} onManage={() => setSheet('purchases')} onOpen={setEntry} />;
  const payments = <Payments loan={loan} onPay={() => setSheet('pay')} onOpen={setEntry} />;
  const check = <StatementCheck key={`${loan.id}-${s.statements.length}`} loan={loan} s={s} onPay={() => setSheet('pay')} />;
  const settings = <Settings loan={loan} onEdit={() => setSheet('settings')} onClose={() => setSheet('close')} />;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <BackLink fallback="/" fallbackLabel="Back to Holdings" className={ROUND_BTN}>
          <ChevronLeftIcon size={18} />
        </BackLink>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="m-0 truncate font-display text-[28px] font-semibold leading-tight tracking-tight lg:text-4xl">{loan.name}</h1>
          <span className="text-xs text-muted lg:text-[13px]">{loan.closed ? 'Closed loan' : 'Loan'} · tracking only</span>
        </span>
        {wide ? <HideButton variant="text" /> : null}
        {wide ? <LockButton variant="text" /> : null}
      </header>
      {loan.closed ? <Callout>This loan is closed. It is kept here with its records.</Callout> : null}
      {standing}
      {wide ? (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-5">
          <div className="flex flex-col gap-5">
            {details}
            {check}
            {settings}
          </div>
          <div className="flex flex-col gap-5">
            {purchaseList}
            {payments}
          </div>
        </div>
      ) : (
        <>
          {details}
          {purchaseList}
          {payments}
          {check}
          {settings}
        </>
      )}
      <PaymentSheet loan={loan} open={sheet === 'pay'} onClose={close} />
      <RateSheet loan={loan} rate={s.aprMillionths} open={sheet === 'rate'} onClose={close} />
      <LoanSettingsSheet loan={loan} open={sheet === 'settings'} onClose={close} />
      <CloseLoanSheet loan={loan} owedCents={s.principalOwedCents} open={sheet === 'close'} onClose={close} />
      <ManagePurchasesSheet loan={loan} open={sheet === 'purchases'} onClose={close} />
      {entry ? <EntrySheet run={runOf(entry)} state={state} today={today} onClose={() => setEntry(null)} /> : null}
    </div>
  );
}
