import { LOAN_PAID_SO_FAR_NOTE, parseAprPercent, parseDollars, uuidv7, type Entry, type Loan, type LoanId } from '@bitcoin-basis/engine';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { countOf, shortDate } from '../../lib/format.ts';
import { lotsWith, planLinks, purchaseOptions, type PurchaseOption } from '../../lib/loans-view.ts';
import { Amount } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Callout, SelectField, TextField } from '../../ui/form-fields.tsx';
import { AprInput, MoneyInput } from '../../ui/formatted-inputs.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useSubmit } from '../../ui/use-submit.ts';
import { cleanNumber } from '../log/model.ts';
import { FormFooter } from '../log/parts.tsx';
import { loanRecordToEdit, useLoanWriter, type LoanDraft } from './loan-writer.ts';

/** Why the draw date matters, in one line. */
export const DRAW_DATE_WHY = 'Interest starts the day the money is drawn, so each purchase counts from its own date.';

/** Statement closing day choices: 1 to 30, then the month's last day (31). */
export const STATEMENT_DAYS = [...Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })), { value: '31', label: 'Last day of the month' }];

const BIG_BUTTON = 'min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]';

// ---- Which purchases ---------------------------------------------------------------------------

/**
 * Tick the purchases a loan paid for. Each ticked one can say a different day the money was drawn (advanced).
 * `chosen` maps lot id to its draw date (null: the purchase's own date).
 */
export function PurchasePicker({ options, loanId, chosen, onChange }: { options: readonly PurchaseOption[]; loanId: LoanId | null; chosen: ReadonlyMap<string, string | null>; onChange(next: Map<string, string | null>): void }) {
  const { state, today } = useLedger();
  const id = useId();
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w.name])), [state.wallets]);
  const loanNames = useMemo(() => new Map(state.loans.map((l) => [l.id, l.name])), [state.loans]);
  const [wallet, setWallet] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const free = (o: PurchaseOption) => o.loanId === null || o.loanId === loanId;
  const shown = options.filter((o) => (wallet === '' || o.walletId === wallet) && (from === '' || o.date >= from) && (to === '' || o.date <= to));
  const pickable = shown.filter(free);
  const walletIds = [...new Set(options.map((o) => o.walletId))];
  const total = options.filter((o) => chosen.has(o.lotId)).reduce((n, o) => n + o.costCents, 0);

  // A purchase an import split across rows is one link: its rows are ticked, unticked and dated together.
  function toggle(o: PurchaseOption) {
    const next = new Map(chosen);
    const on = !next.has(o.lotId);
    for (const lot of lotsWith(o, loanId)) {
      if (!on) next.delete(lot);
      else next.set(lot, o.loanId === loanId && o.drawDate !== null && o.drawDate !== o.drawDefault ? o.drawDate : null);
    }
    onChange(next);
  }
  function setDraw(o: PurchaseOption, date: string) {
    const next = new Map(chosen);
    for (const lot of lotsWith(o, loanId)) next.set(lot, date === '' || date === o.drawDefault ? null : date);
    onChange(next);
  }
  function selectShown(on: boolean) {
    const next = new Map(chosen);
    for (const o of pickable) {
      for (const lot of lotsWith(o, loanId)) {
        if (on && !next.has(lot)) next.set(lot, null);
        if (!on) next.delete(lot);
      }
    }
    onChange(next);
  }
  const allShown = pickable.length > 0 && pickable.every((o) => chosen.has(o.lotId));

  if (options.length === 0) return <p className="m-0 text-sm text-muted">No purchases yet. Log a purchase with &ldquo;Paid with&rdquo; set to this loan, or add them here later.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] leading-snug text-muted">{DRAW_DATE_WHY}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SelectField frameClassName="col-span-2 sm:col-span-1" label="Wallet" value={wallet} onChange={(e) => setWallet(e.target.value)} options={[{ value: '', label: 'All' }, ...walletIds.map((w) => ({ value: w, label: wallets.get(w) ?? 'Unknown' }))]} className="!min-h-11 !text-sm" />
        <TextField label="From" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="!min-h-11 !px-2 !text-sm" />
        <TextField label="To" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="!min-h-11 !px-2 !text-sm" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span role="status" className="text-xs text-muted">
          {countOf(chosen.size, 'purchase')} chosen · <PlainMoney cents={total} /> drawn
        </span>
        <Button variant="ghost" className="-mr-3 flex-none whitespace-nowrap !px-3 text-[13px]" disabled={pickable.length === 0} onClick={() => selectShown(!allShown)}>
          {allShown ? 'Clear these' : `Select all ${pickable.length}`}
        </Button>
      </div>
      <ul aria-label="Purchases" className="m-0 flex list-none flex-col rounded-2xl border border-line bg-bg p-0">
        {shown.length === 0 ? <li className="py-3 text-sm text-muted">No purchases match.</li> : null}
        {shown.map((o, i) => {
          const on = chosen.has(o.lotId);
          const other = !free(o);
          const draw = chosen.get(o.lotId) ?? null;
          const rowId = `${id}-${i}`;
          return (
            <li key={o.lotId} className="flex flex-col border-b border-line px-3 py-1 last:border-b-0">
              <label htmlFor={rowId} className={cx('flex min-h-[52px] items-center gap-3', other ? 'cursor-default opacity-60' : 'cursor-pointer')}>
                <input id={rowId} type="checkbox" checked={on} disabled={other} onChange={() => toggle(o)} className="size-5 flex-none accent-accent" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-semibold">
                    <Amount sats={o.sats} short showUnit interactive={false} /> · <PlainMoney cents={o.costCents} />
                  </span>
                  <span className="text-xs text-muted [overflow-wrap:anywhere]">
                    {shortDate(o.date)} · {wallets.get(o.walletId) ?? 'Unknown wallet'}
                    {other ? ` · Paid with ${loanNames.get(o.loanId ?? '') ?? 'another loan'}` : ''}
                  </span>
                </span>
              </label>
              {on ? (
                editing === o.lotId ? (
                  <TextField label="Money drawn on" type="date" value={draw ?? o.drawDefault} max={today} onChange={(e) => setDraw(o, e.target.value)} frameClassName="mb-2 ml-8" className="!min-h-11" />
                ) : (
                  <span className="-mt-1 mb-1 ml-8 flex items-center gap-1 text-xs text-muted">
                    Drawn {shortDate(draw ?? o.drawDefault)}
                    <button type="button" onClick={() => setEditing(o.lotId)} aria-label={`Change the draw date for the ${shortDate(o.date)} purchase`} className="min-h-11 bg-transparent px-1.5 text-xs font-semibold text-amber">
                      Change
                    </button>
                  </span>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Drafts for a link plan: new links, removed links (with a reason) and changed draw dates. */
function linkDrafts(loanId: LoanId, options: readonly PurchaseOption[], chosen: ReadonlyMap<string, string | null>): LoanDraft[] {
  const plan = planLinks(loanId, options, chosen);
  return [
    ...plan.remove.map((entryId): LoanDraft => ({ draft: { kind: 'delete', replaces: entryId, reason: 'Not paid with this loan' } })),
    ...plan.change.map(({ entryId, ...link }): LoanDraft => ({ draft: { kind: 'loan-link', loan: loanId, ...link, replaces: entryId, reason: 'Draw date changed' } })),
    ...plan.add.map((a): LoanDraft => ({ draft: { kind: 'loan-link', loan: loanId, lot: a.lot, ...(a.drawDate === undefined ? {} : { drawDate: a.drawDate }) } })),
  ];
}

// ---- Set up a loan ---------------------------------------------------------------------------

function useOpenLoanNames(): Set<string> {
  const { state } = useLedger();
  return useMemo(() => new Set(state.loans.filter((l) => !l.closed).map((l) => l.name.trim().toLowerCase())), [state.loans]);
}

/** A loan set up from the Bought form: not saved yet. It is saved with the purchase (and its link), or not at all. */
export interface PendingLoan {
  id: LoanId;
  name: string;
  /** The loan record first, then any "interest paid so far". */
  entries: Entry[];
}

/**
 * Track a loan: its name, rate, statement day and (optional) limit and interest paid so far, then which purchases it
 * paid for. One save. With `onPending` (from the Bought form) it skips the purchases step and saves nothing: the loan
 * goes back to the form, which saves it together with the purchase.
 */
export function LoanSetupSheet({ open, onClose, onPending }: { open: boolean; onClose(): void; onPending?(loan: PendingLoan): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Track a loan" fixedHeight>
      {open ? <SetupBody onClose={onClose} {...(onPending ? { onPending } : {})} /> : null}
    </Sheet>
  );
}

function SetupBody({ onClose, onPending }: { onClose(): void; onPending?(loan: PendingLoan): void }) {
  const quick = onPending !== undefined;
  const { entries, state, today } = useLedger();
  const toast = useToast();
  const navigate = useNavigate();
  const writer = useLoanWriter();
  const taken = useOpenLoanNames();
  const [loanId] = useState(() => uuidv7());
  const [step, setStep] = useState<'details' | 'purchases'>('details');
  const [name, setName] = useState('');
  const [apr, setApr] = useState('');
  const [day, setDay] = useState(String(Math.min(31, Number(today.slice(8, 10)))));
  const [limit, setLimit] = useState('');
  const [paidSoFar, setPaidSoFar] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [tried, setTried] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const options = useMemo(() => purchaseOptions(entries, state), [entries, state]);
  const [chosen, setChosen] = useState<Map<string, string | null>>(new Map());

  const aprMillionths = parseAprPercent(cleanNumber(apr));
  const limitCents = limit === '' ? null : parseDollars(cleanNumber(limit));
  const soFarCents = paidSoFar === '' ? 0 : parseDollars(cleanNumber(paidSoFar));
  const errors = {
    name: name.trim() === '' ? 'Give it a name, like HELOC.' : taken.has(name.trim().toLowerCase()) ? `You already have a loan called ${name.trim()}.` : null,
    apr: aprMillionths === null ? 'Enter the rate, like 6.5.' : null,
    limit: limit !== '' && limitCents === null ? 'Enter a dollar amount, or leave it empty.' : null,
    soFar: soFarCents === null ? 'Enter a dollar amount, or leave it empty.' : null,
    asOf: soFarCents !== null && soFarCents > 0 && (asOf === '' || asOf > today) ? 'Pick today or an earlier day.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function drafts(): LoanDraft[] {
    const draws = [...chosen.entries()].map(([lot, d]) => d ?? options.find((o) => o.lotId === lot)?.date ?? today);
    const starts = [today, ...draws, ...(soFarCents !== null && soFarCents > 0 ? [asOf] : [])].sort();
    const loan: LoanDraft = {
      draft: {
        kind: 'loan',
        loan: loanId,
        name: name.trim(),
        opened: starts[0] ?? today,
        aprMillionths: aprMillionths ?? 0,
        statementDay: Number(day),
        ...(limitCents === null ? {} : { creditLimitCents: limitCents }),
      },
    };
    const soFar: LoanDraft[] = soFarCents !== null && soFarCents > 0 ? [{ draft: { kind: 'loan-payment', loan: loanId, interestCents: soFarCents, principalCents: 0, note: LOAN_PAID_SO_FAR_NOTE }, date: asOf }] : [];
    return [loan, ...soFar, ...linkDrafts(loanId, options, chosen)];
  }

  const saver = useSubmit(async () => {
    const made = writer.make(drafts());
    if (made.problems.length > 0) {
      setProblems(made.problems);
      return;
    }
    if (onPending) {
      onPending({ id: loanId, name: name.trim(), entries: made.entries });
      onClose();
      return;
    }
    await writer.save(made.entries);
    toast.show('Loan added.', { success: true });
    onClose();
    navigate(`/loans/${loanId}`);
  });

  function next() {
    setTried(true);
    if (!valid) return;
    if (quick) void saver.run();
    else setStep('purchases');
  }

  if (step === 'purchases') {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void saver.run();
        }}
      >
        <h3 className="m-0 text-[15px] font-semibold">Which purchases were paid with {name.trim()}?</h3>
        <PurchasePicker options={options} loanId={loanId} chosen={chosen} onChange={setChosen} />
        {problems.length > 0 ? (
          <Callout tone="error" title="This cannot be saved yet" role="alert">
            {problems.join(' ')}
          </Callout>
        ) : null}
        <FormFooter>
          <Button variant="secondary" onClick={() => setStep('details')} className="min-h-14 rounded-[18px]">
            Back
          </Button>
          <Button type="submit" variant="primary" disabled={saver.busy} className={BIG_BUTTON}>
            {saver.busy ? 'Saving…' : 'Save loan'}
          </Button>
        </FormFooter>
      </form>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <p className="m-0 text-[13px] leading-snug text-muted">
        For money you borrowed to buy Bitcoin, like a home equity line. Tracking only: it never changes your cost or taxes.{quick ? ' It is saved when you save the purchase.' : ''}
      </p>
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="HELOC" autoComplete="off" error={tried ? errors.name : null} />
      <AprInput label="Interest rate (APR)" value={apr} onChange={setApr} hint="Today’s rate. If it changes later, add the change on the loan’s page." error={tried ? errors.apr : null} />
      <SelectField label="Statement closing day" value={day} onChange={(e) => setDay(e.target.value)} options={STATEMENT_DAYS} hint="The “closing date” on your monthly statement." />
      <MoneyInput label="Credit limit (optional)" value={limit} onChange={setLimit} error={tried ? errors.limit : null} />
      <details className="rounded-2xl border border-line px-3.5 py-1" open={paidSoFar !== ''}>
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-soft">Already paying it? Add the interest paid so far</summary>
        <div className="flex flex-col gap-3 pb-3">
          <MoneyInput label="Interest paid so far" value={paidSoFar} onChange={setPaidSoFar} hint="The total interest on your statements until now." error={tried ? errors.soFar : null} />
          <TextField label="As of" type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} hint="The day of your last payment." error={tried ? errors.asOf : null} />
        </div>
      </details>
      {problems.length > 0 ? (
        <Callout tone="error" title="This cannot be saved yet" role="alert">
          {problems.join(' ')}
        </Callout>
      ) : null}
      <FormFooter>
        <Button type="submit" variant="primary" disabled={saver.busy} className={BIG_BUTTON}>
          {quick ? 'Use this loan' : 'Next: its purchases'}
        </Button>
      </FormFooter>
    </form>
  );
}

// ---- Add or remove purchases later ---------------------------------------------------------

/**
 * A purchase older than the loan's start: the loan record gets a new version that starts on the earliest draw, so its
 * rate history covers every day money was drawn (interest itself is the same: before its first rate, the first rate applies).
 */
function startEarlier(entries: readonly Entry[], loan: Loan, options: readonly PurchaseOption[], chosen: ReadonlyMap<string, string | null>): LoanDraft[] {
  const earliest = [...chosen.entries()].map(([lot, d]) => d ?? options.find((o) => o.lotId === lot)?.drawDefault ?? loan.opened).sort()[0];
  if (earliest === undefined || earliest >= loan.opened) return [];
  const record = loanRecordToEdit(entries, loan.id);
  if (record === null) return [];
  const { id, at, tz, ...rest } = record.head;
  void at;
  void tz;
  return [{ draft: { ...rest, opened: earliest, replaces: id, reason: 'Starts with its oldest purchase' }, keep: record.keep }];
}

/** The loan page's "Add purchases": tick or untick, change a draw date, one save. */
export function ManagePurchasesSheet({ loan, open, onClose }: { loan: Loan; open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Purchases paid with it" fixedHeight>
      {open ? <ManageBody loan={loan} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ManageBody({ loan, onClose }: { loan: Loan; onClose(): void }) {
  const { entries, state } = useLedger();
  const toast = useToast();
  const writer = useLoanWriter();
  const options = useMemo(() => purchaseOptions(entries, state), [entries, state]);
  const [chosen, setChosen] = useState<Map<string, string | null>>(() => new Map(options.filter((o) => o.loanId === loan.id).map((o) => [o.lotId, o.drawDate !== null && o.drawDate !== o.drawDefault ? o.drawDate : null])));
  const [problems, setProblems] = useState<string[]>([]);
  const links = linkDrafts(loan.id, options, chosen);
  const drafts = links.length === 0 ? links : [...startEarlier(entries, loan, options, chosen), ...links];
  const saver = useSubmit(async () => {
    const made = writer.make(drafts);
    if (made.problems.length > 0) {
      setProblems(made.problems);
      return;
    }
    if (made.entries.length > 0) await writer.save(made.entries);
    toast.show('Purchases saved.', { success: true });
    onClose();
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void saver.run();
      }}
    >
      <PurchasePicker options={options} loanId={loan.id} chosen={chosen} onChange={setChosen} />
      {problems.length > 0 ? (
        <Callout tone="error" title="This cannot be saved yet" role="alert">
          {problems.join(' ')}
        </Callout>
      ) : null}
      <FormFooter>
        <Button variant="secondary" onClick={onClose} className="min-h-14 rounded-[18px]">
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saver.busy || drafts.length === 0} className={BIG_BUTTON}>
          {saver.busy ? 'Saving…' : 'Save'}
        </Button>
      </FormFooter>
    </form>
  );
}
