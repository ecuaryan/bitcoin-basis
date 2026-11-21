import { formatAprPercent, isValidLocalDate, loanSummary, parseAprPercent, parseDollars, suggestLoanPayment, type DayCount, type Loan } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { shortDate } from '../../lib/format.ts';
import { buildItems } from '../../lib/entry-list.ts';
import { Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Callout, SelectField, SummaryRow, TextField } from '../../ui/form-fields.tsx';
import { AprInput, MoneyInput } from '../../ui/formatted-inputs.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useSubmit } from '../../ui/use-submit.ts';
import { centsText, cleanNumber } from '../log/model.ts';
import { FormFooter } from '../log/parts.tsx';
import { STATEMENT_DAYS } from './LoanSetup.tsx';
import { useLoanWriter, type LoanDraft } from './loan-writer.ts';

const BIG_BUTTON = 'min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]';

/** A form in a sheet with its buttons pinned at the bottom and any save problem said plainly. */
function SheetForm({ onSubmit, problems, children, footer }: { onSubmit(): void; problems: string[]; children: ReactNode; footer: ReactNode }) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {problems.length > 0 ? (
        <Callout tone="error" title="This cannot be saved yet" role="alert">
          {problems.join(' ')}
        </Callout>
      ) : null}
      <FormFooter>{footer}</FormFooter>
    </form>
  );
}

/** Save drafts in one go, or show why they cannot be saved. */
function useSave(onDone: (count: number) => void) {
  const writer = useLoanWriter();
  const [problems, setProblems] = useState<string[]>([]);
  const submit = useSubmit(async (drafts: LoanDraft[]) => {
    if (drafts.length === 0) {
      onDone(0);
      return;
    }
    const made = writer.make(drafts);
    if (made.problems.length > 0) {
      setProblems(made.problems);
      return;
    }
    await writer.save(made.entries);
    onDone(made.entries.length);
  });
  return { run: submit.run, busy: submit.busy, problems, make: writer.make };
}

// ---- Log a payment ----------------------------------------------------------------------------

export function PaymentSheet({ loan, open, onClose }: { loan: Loan; open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Log a payment" fixedHeight>
      {open ? <PaymentBody loan={loan} onClose={onClose} /> : null}
    </Sheet>
  );
}

/**
 * Date, amount and its interest part (pre-filled with the engine's estimate for the cycle it pays). The rest of the
 * amount lowers what is owed. Until the person types an amount, it follows the interest part (an interest-only payment).
 */
function PaymentBody({ loan, onClose }: { loan: Loan; onClose(): void }) {
  const { state, today } = useLedger();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [interestText, setInterestText] = useState<string | null>(null);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const save = useSave(() => {
    toast.show('Payment saved.', { success: true });
    onClose();
  });
  const okDate = isValidLocalDate(date) && date <= today;
  const s = useMemo(() => (okDate ? suggestLoanPayment(state, loan.id, date) : null), [okDate, state, loan.id, date]);
  // The engine's estimate for the cycle this payment pays, less any interest already logged for that cycle.
  const suggested = s?.interestCents ?? 0;
  const interestCents = interestText === null ? suggested : parseDollars(cleanNumber(interestText));
  const amountCents = amountText === null ? interestCents : parseDollars(cleanNumber(amountText));
  const principalCents = amountCents !== null && interestCents !== null ? amountCents - interestCents : null;
  const errors = {
    date: okDate ? null : 'Pick today or an earlier day.',
    amount: amountCents === null || amountCents <= 0 ? 'Enter what you paid.' : null,
    interest: interestCents === null ? 'Enter the interest part, or 0.' : principalCents !== null && principalCents < 0 ? 'The interest part can’t be more than what you paid.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const drafts: LoanDraft[] = valid && interestCents !== null && principalCents !== null ? [{ draft: { kind: 'loan-payment', loan: loan.id, interestCents, principalCents }, date }] : [];
  const owedAfter = useMemo(() => {
    if (drafts.length === 0) return null;
    const after = save.make(drafts).after;
    return loanSummary(after, loan.id, null, date > today ? date : today)?.principalOwedCents ?? null;
  }, [drafts.length, interestCents, principalCents, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = s === null ? '' : `${shortDate(s.fromDate, today)} to ${shortDate(s.throughDate, today)}`;
  const hint =
    s === null ? undefined : s.alreadyPaidCents > 0 && s.interestCents === 0 ? (
      `Interest for ${range} is already logged. Enter any extra, or 0.`
    ) : s.alreadyPaidCents > 0 ? (
      <>
        ≈ what is left for {range} (<Money cents={s.alreadyPaidCents} /> of it is already logged). Use the number on your statement.
      </>
    ) : (
      `≈ from your rate for ${range}. Use the number on your statement.`
    );
  return (
    <SheetForm
      problems={save.problems}
      onSubmit={() => {
        setTried(true);
        if (valid) void save.run(drafts);
      }}
      footer={
        <Button type="submit" variant="primary" disabled={save.busy} className={BIG_BUTTON}>
          {save.busy ? 'Saving…' : 'Save payment'}
        </Button>
      }
    >
      <p className="m-0 text-[13px] leading-snug text-muted">A payment has an interest part, what the lender charged for the month. Anything more lowers what you owe.</p>
      <TextField label="Paid on" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} error={tried ? errors.date : null} />
      <MoneyInput label="Amount paid" value={amountText ?? centsText(amountCents)} onChange={setAmountText} error={tried ? errors.amount : null} />
      <MoneyInput label="Interest part" value={interestText ?? centsText(interestCents)} onChange={setInterestText} hint={hint} error={tried ? errors.interest : null} />
      <dl aria-label="After this payment" className="m-0 rounded-2xl border border-line bg-bg px-3.5 py-1">
        <SummaryRow label="Lowers what you owe by">{principalCents === null || principalCents < 0 ? '—' : <Money cents={principalCents} />}</SummaryRow>
        <SummaryRow label="Owed after this">{owedAfter === null ? '—' : <Money cents={owedAfter} />}</SummaryRow>
      </dl>
    </SheetForm>
  );
}

// ---- Rate changed ----------------------------------------------------------------------------

export function RateSheet({ loan, rate, open, onClose }: { loan: Loan; rate: number; open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Rate changed">
      {open ? <RateBody loan={loan} rate={rate} onClose={onClose} /> : null}
    </Sheet>
  );
}

function RateBody({ loan, rate, onClose }: { loan: Loan; rate: number; onClose(): void }) {
  const { today } = useLedger();
  const toast = useToast();
  const [apr, setApr] = useState('');
  const [from, setFrom] = useState(today);
  const [tried, setTried] = useState(false);
  const save = useSave(() => {
    toast.show('Rate saved.', { success: true });
    onClose();
  });
  const aprMillionths = parseAprPercent(cleanNumber(apr));
  const errors = { apr: aprMillionths === null ? 'Enter the new rate, like 7.25.' : null, from: isValidLocalDate(from) ? null : 'Pick the day it starts.' };
  return (
    <SheetForm
      problems={save.problems}
      onSubmit={() => {
        setTried(true);
        if (aprMillionths === null || errors.from !== null) return;
        void save.run([{ draft: { kind: 'loan-update', loan: loan.id, aprMillionths, rateFrom: from } }]);
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-12 rounded-2xl">
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.busy} className="min-h-12 flex-1 rounded-2xl">
            {save.busy ? 'Saving…' : 'Save rate'}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-muted">Now {formatAprPercent(rate)}. Your lender’s notice says the new rate and the day it starts.</p>
      <AprInput label="New rate (APR)" value={apr} onChange={setApr} error={tried ? errors.apr : null} />
      <TextField label="Starts on" type="date" value={from} onChange={(e) => setFrom(e.target.value)} hint="Interest from this day on uses the new rate." error={tried ? errors.from : null} />
    </SheetForm>
  );
}

// ---- Loan settings ---------------------------------------------------------------------------

const DAY_COUNT_OPTIONS: readonly { value: DayCount; label: string }[] = [
  { value: 'actual/365', label: '365 days' },
  { value: 'actual/360', label: '360 days' },
];

export function LoanSettingsSheet({ loan, open, onClose }: { loan: Loan; open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Loan settings">
      {open ? <SettingsBody loan={loan} onClose={onClose} /> : null}
    </Sheet>
  );
}

function SettingsBody({ loan, onClose }: { loan: Loan; onClose(): void }) {
  const { entries, state } = useLedger();
  const toast = useToast();
  const [name, setName] = useState(loan.name);
  const [limit, setLimit] = useState(loan.creditLimitCents === null ? '' : centsText(loan.creditLimitCents));
  const [day, setDay] = useState(loan.statementDay === null ? '' : String(loan.statementDay));
  const [dayCount, setDayCount] = useState<DayCount>(loan.dayCount);
  const [tried, setTried] = useState(false);
  const save = useSave((n) => {
    toast.show(n === 0 ? 'Nothing changed.' : 'Saved.', { success: n > 0 });
    onClose();
  });
  const limitCents = limit === '' ? null : parseDollars(cleanNumber(limit));
  const taken = state.loans.some((l) => l.id !== loan.id && !l.closed && l.name.trim().toLowerCase() === name.trim().toLowerCase());
  const errors = {
    name: name.trim() === '' ? 'Give it a name.' : taken ? `You already have a loan called ${name.trim()}.` : null,
    limit: limit !== '' && limitCents === null ? 'Enter a dollar amount.' : loan.creditLimitCents !== null && limit === '' ? 'Enter the limit (it can change, not go away).' : null,
  };

  function drafts(): LoanDraft[] {
    const patch = {
      ...(name.trim() !== loan.name ? { name: name.trim() } : {}),
      ...(limitCents !== null && limitCents !== loan.creditLimitCents ? { creditLimitCents: limitCents } : {}),
      ...(day !== '' && Number(day) !== loan.statementDay ? { statementDay: Number(day) } : {}),
    };
    const out: LoanDraft[] = Object.keys(patch).length > 0 ? [{ draft: { kind: 'loan-update', loan: loan.id, ...patch } }] : [];
    if (dayCount !== loan.dayCount) {
      // How interest is counted lives on the loan record itself: a new version of it, with a reason.
      const head = buildItems(entries).find((i) => !i.deleted && i.current.kind === 'loan' && i.current.loan === loan.id)?.current;
      if (head?.kind === 'loan') {
        const { id, at, tz, ...rest } = head;
        void id;
        void at;
        void tz;
        out.push({ draft: { ...rest, dayCount, replaces: head.id, reason: 'Changed how interest is counted' } });
      }
    }
    return out;
  }
  return (
    <SheetForm
      problems={save.problems}
      onSubmit={() => {
        setTried(true);
        if (errors.name === null && errors.limit === null) void save.run(drafts());
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-12 rounded-2xl">
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.busy} className="min-h-12 flex-1 rounded-2xl">
            {save.busy ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" error={tried ? errors.name : null} />
      <MoneyInput label="Credit limit" value={limit} onChange={setLimit} error={tried ? errors.limit : null} />
      <SelectField label="Statement closing day" value={day} onChange={(e) => setDay(e.target.value)} options={day === '' ? [{ value: '', label: 'Not set' }, ...STATEMENT_DAYS] : STATEMENT_DAYS} hint="A new day counts from today on. Payments already logged keep the day they were made under." />
      <details className="rounded-2xl border border-line px-3.5 py-1" open={dayCount !== 'actual/365'}>
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-soft">Advanced</summary>
        <div className="flex flex-col gap-2 pb-3">
          <span className="text-xs text-muted">Days in the lender’s year</span>
          <Segmented<DayCount> label="Days in the lender’s year" value={dayCount} onChange={setDayCount} options={DAY_COUNT_OPTIONS} />
          <span className="text-xs leading-snug text-muted">Most lenders divide the yearly rate by 365 to get each day’s interest. Some use 360. Your loan agreement says which.</span>
        </div>
      </details>
    </SheetForm>
  );
}

// ---- Close ------------------------------------------------------------------------------------

export function CloseLoanSheet({ loan, owedCents, open, onClose }: { loan: Loan; owedCents: number; open: boolean; onClose(): void }) {
  const toast = useToast();
  const save = useSave(() => {
    toast.show(`${loan.name} is closed.`, { success: true });
    onClose();
  });
  return (
    <Sheet open={open} onClose={onClose} title={`Close ${loan.name}?`}>
      <div className="flex flex-col gap-4 pb-3">
        <p className="m-0 text-[15px] leading-relaxed text-soft">A closed loan leaves Holdings. Everything stays in your records, and you can reopen it.</p>
        {owedCents > 0 ? (
          <Callout tone="warn" title="Your records still show money owed">
            <Money cents={owedCents} /> is owed. If it is paid off, log that payment first.
          </Callout>
        ) : null}
        {save.problems.length > 0 ? (
          <Callout tone="error" role="alert">
            {save.problems.join(' ')}
          </Callout>
        ) : null}
        <div className="flex gap-2.5">
          <Button className="flex-1" onClick={onClose}>
            Keep it open
          </Button>
          <Button variant="primary" className="flex-[1.6]" disabled={save.busy} onClick={() => void save.run([{ draft: { kind: 'loan-update', loan: loan.id, closed: true } }])}>
            {save.busy ? 'Saving…' : 'Close loan'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Bring a closed loan back. */
export function useReopen(loan: Loan): { run(): Promise<void>; busy: boolean } {
  const toast = useToast();
  const save = useSave(() => toast.show(`${loan.name} is open again.`, { success: true }));
  return { run: () => save.run([{ draft: { kind: 'loan-update', loan: loan.id, closed: false } }]), busy: save.busy };
}
