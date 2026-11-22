/**
 * Loan records in replay (docs/loans-spec.md). They are applied after every coin entry and touch nothing but
 * `state.loans`, so they can never change lots, cost basis or gains. Internal to replay.
 *
 * Two passes. First the loans themselves (`loan` and `loan-update`) in timeline order, so names, closing and the
 * rate and statement-day histories mean what they meant at each moment (an update dated before its loan was created
 * applies right after the creation). Then every other record, by `at` then id, against the loans as they ended up.
 */
import { addVolume, problem, type Book, type Problem } from './book.ts';
import { latestMonthDay, localDate } from './dates.ts';
import { compareEntries, compareStrings } from './order.ts';
import type { Entry, EntryId, Loan, LoanEntry, LoanId, LoanRecordEntry, LoanStatementDay, LoanUpdateEntry, LocalDate, Lot, LotId } from './types.ts';

interface Work {
  loan: Loan;
  /** Payments with the `interestThrough` the entry gave (resolved after replay, from the statement-day history). */
  rawThrough: Map<EntryId, LocalDate | undefined>;
}

const nameKey = (name: string): string => name.trim().toLowerCase();

function nameTaken(loans: ReadonlyMap<LoanId, Work>, name: string, except: LoanId | null): boolean {
  return [...loans.values()].some(({ loan }) => loan.id !== except && !loan.closed && nameKey(loan.name) === nameKey(name));
}

const nameTakenProblem = (name: string): Problem => problem('loan-name-taken', `another loan is already named "${name.trim()}"`);

/** Add a dated value to a history; a later record for the same day replaces the earlier one. */
function setFrom<T extends { from: LocalDate }>(list: T[], item: T): T[] {
  return [...list.filter((x) => x.from !== item.from), item];
}

function createLoan(loans: Map<LoanId, Work>, e: LoanEntry): Problem | null {
  if (loans.has(e.loan)) return problem('loan-exists', `loan ${e.loan} already exists`);
  if (nameTaken(loans, e.name, null)) return nameTakenProblem(e.name);
  const statementDays: LoanStatementDay[] = e.statementDay === undefined ? [] : [{ entryId: e.id, from: e.opened, day: e.statementDay }];
  loans.set(e.loan, {
    loan: { id: e.loan, name: e.name.trim(), opened: e.opened, dayCount: e.dayCount ?? 'actual/365', creditLimitCents: e.creditLimitCents ?? null, statementDay: e.statementDay ?? null, statementDays, closed: false, rates: [{ entryId: e.id, from: e.opened, aprMillionths: e.aprMillionths }], draws: [], payments: [], statements: [] },
    rawThrough: new Map(),
  });
  return null;
}

function updateLoan(l: Loan, loans: ReadonlyMap<LoanId, Work>, e: LoanUpdateEntry, date: LocalDate): Problem | null {
  const name = e.name ?? l.name;
  const closed = e.closed ?? l.closed;
  if (!closed && nameTaken(loans, name, l.id)) return nameTakenProblem(name);
  l.name = name.trim();
  l.closed = closed;
  l.creditLimitCents = e.creditLimitCents ?? l.creditLimitCents;
  if (e.statementDay !== undefined) {
    l.statementDay = e.statementDay;
    l.statementDays = setFrom(l.statementDays, { entryId: e.id, from: date, day: e.statementDay });
  }
  if (e.aprMillionths !== undefined) l.rates = setFrom(l.rates, { entryId: e.id, from: e.rateFrom ?? date, aprMillionths: e.aprMillionths });
  return null;
}

type Report = (e: LoanRecordEntry, bad: Problem | null) => void;

/** Pass 1: loans and their updates in timeline order. */
function applyLoans(loans: Map<LoanId, Work>, entries: readonly LoanRecordEntry[], report: Report): void {
  const early = new Map<LoanId, LoanUpdateEntry[]>();
  const update = (u: LoanUpdateEntry): void => report(u, updateLoan((loans.get(u.loan) as Work).loan, loans, u, localDate(u.at, u.tz)));
  for (const e of entries) {
    if (e.kind === 'loan') {
      const bad = createLoan(loans, e);
      report(e, bad);
      // Updates that waited for this loan apply now. If it was not created (its name was taken), they keep waiting
      // for a later version and are reported with the rest at the end, never dropped without a word.
      if (bad === null) {
        for (const u of early.get(e.loan) ?? []) update(u);
        early.delete(e.loan);
      }
    } else if (loans.has((e as LoanUpdateEntry).loan)) update(e as LoanUpdateEntry);
    else early.set((e as LoanUpdateEntry).loan, [...(early.get((e as LoanUpdateEntry).loan) ?? []), e as LoanUpdateEntry]);
  }
  for (const list of early.values()) for (const u of list) report(u, problem('unknown-loan', `loan ${u.loan} does not exist`));
}

/**
 * The note the app gives "interest paid so far" when a loan is set up mid-stream. Such a payment (interest only) is a lump
 * sum of the loan's history: it settles every cycle through its `interestThrough`, and it is not split into tax years.
 */
export const LOAN_PAID_SO_FAR_NOTE = 'Interest paid before tracking started';

function link(book: Book, l: Loan, linked: Map<LotId, EntryId>, byId: ReadonlyMap<EntryId, Entry>, e: Extract<LoanRecordEntry, { kind: 'loan-link' }>): Problem | null {
  const ids = [e.lot, ...(e.alsoLots ?? [])];
  const lots: Lot[] = [];
  const present: LotId[] = [];
  let costCents = 0;
  for (const id of ids) {
    const lot = book.lots.get(id);
    if (linked.has(id) || (lot !== undefined && lots.includes(lot))) return problem('already-linked', 'this purchase is already linked to a loan; unlink it first');
    // A purchase that is not in the ledger (removed): its draw still counts if the link says how much and when.
    if (lot === undefined) continue;
    const origin = byId.get(lot.originEntryId);
    if (origin === undefined || (origin.kind !== 'buy' && origin.kind !== 'opening-lot')) return problem('unknown-purchase', `${id} is not a purchase or imported lot in the ledger`);
    lots.push(lot);
    present.push(id);
    costCents += origin.costCents;
  }
  const gone = present.length < ids.length;
  if (gone && (e.drawCents === undefined || (present.length === 0 && e.drawDate === undefined))) {
    return problem('unknown-purchase', `${ids.find((id) => !present.includes(id)) as LotId} is not a purchase or imported lot in the ledger`);
  }
  const cents = e.drawCents ?? costCents;
  const bad = addVolume(book, 0, cents);
  if (bad !== null) return bad;
  for (const id of ids) linked.set(id, e.id);
  const date = e.drawDate ?? lots.map((x) => x.acquiredDate).sort(compareStrings)[0];
  // With every purchase gone it is money drawn for nothing tracked: an other draw, so what is owed stays true.
  l.draws.push({ entryId: e.id, date: date as LocalDate, cents, lotId: present[0] ?? null, lotIds: present });
  return null;
}

/** Pass 2: draws, links, payments and statements. */
function applyRecord(book: Book, loans: ReadonlyMap<LoanId, Work>, linked: Map<LotId, EntryId>, byId: ReadonlyMap<EntryId, Entry>, e: Exclude<LoanRecordEntry, LoanEntry | LoanUpdateEntry>): Problem | null {
  const work = loans.get(e.loan);
  if (work === undefined) return problem('unknown-loan', `loan ${e.loan} does not exist`);
  const l = work.loan;
  const date = localDate(e.at, e.tz);
  switch (e.kind) {
    case 'loan-draw': {
      const bad = addVolume(book, 0, e.cents);
      if (bad === null) l.draws.push({ entryId: e.id, date, cents: e.cents, lotId: null, lotIds: [] });
      return bad;
    }
    case 'loan-link':
      return link(book, l, linked, byId, e);
    case 'loan-payment': {
      const bad = addVolume(book, 0, e.interestCents + e.principalCents);
      if (bad !== null) return bad;
      const paidSoFar = e.principalCents === 0 && e.note === LOAN_PAID_SO_FAR_NOTE;
      l.payments.push({ entryId: e.id, date, interestCents: e.interestCents, principalCents: e.principalCents, interestThrough: date, ...(paidSoFar ? { paidSoFar } : {}) });
      work.rawThrough.set(e.id, e.interestThrough);
      return null;
    }
    case 'loan-statement':
      l.statements.push({ entryId: e.id, date, balanceCents: e.balanceCents });
      return null;
  }
}

/** The statement day in force on `date` (the first one before any), or null if the loan has none. */
export function statementDayOn(loan: Pick<Loan, 'statementDays'>, date: LocalDate): number | null {
  const d = [...loan.statementDays].reverse().find((x) => x.from <= date) ?? loan.statementDays[0];
  return d === undefined ? null : d.day;
}

/** Draws − principal repaid by the end of `date` (0 or less: nothing owed). */
function principalOn(loan: Loan, date: LocalDate): number {
  let net = 0;
  for (const d of loan.draws) if (d.date <= date) net += d.cents;
  for (const p of loan.payments) if (p.date <= date) net -= p.principalCents;
  return net;
}

/** Apply every loan record after the coin entries. Problems go to `state.errors` like any other entry's. */
export function applyLoanEntries(book: Book, entries: readonly LoanRecordEntry[], byId: ReadonlyMap<EntryId, Entry>): void {
  const loans = new Map<LoanId, Work>();
  const linked = new Map<LotId, EntryId>();
  const report: Report = (e, bad) => {
    if (bad === null) book.state.applied.push(e.id);
    else book.state.errors.push({ entryId: e.id, ...bad });
  };
  const ordered = [...entries].sort(compareEntries);
  applyLoans(loans, ordered.filter((e) => e.kind === 'loan' || e.kind === 'loan-update'), report);
  for (const e of ordered) if (e.kind !== 'loan' && e.kind !== 'loan-update') report(e, applyRecord(book, loans, linked, byId, e));
  for (const { loan, rawThrough } of loans.values()) {
    loan.rates.sort((a, b) => compareStrings(a.from, b.from));
    loan.statementDays.sort((a, b) => compareStrings(a.from, b.from));
    loan.draws.sort((a, b) => compareStrings(a.date, b.date) || compareStrings(a.lotId ?? a.entryId, b.lotId ?? b.entryId));
    for (const p of loan.payments) {
      const day = statementDayOn(loan, p.date);
      // A payoff (principal and interest that leave nothing owed) pays interest up to its own day, like a lender's payoff quote.
      const payoff = p.principalCents > 0 && p.interestCents > 0 && principalOn(loan, p.date) <= 0;
      p.interestThrough = rawThrough.get(p.entryId) ?? (day === null || payoff ? p.date : latestMonthDay(p.date, day));
    }
    book.state.loans.push(loan);
  }
}
