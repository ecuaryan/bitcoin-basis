/**
 * Loan records in replay (docs/loans-spec.md). They are applied after every coin entry and touch nothing but
 * `state.loans`, so they can never change lots, cost basis or gains. Internal to replay.
 */
import { addVolume, problem, type Book, type Problem } from './book.ts';
import { latestMonthDay, localDate } from './dates.ts';
import { compareEntries, compareStrings } from './order.ts';
import type { Entry, EntryId, Loan, LoanId, LoanRecordEntry, LocalDate, LotId } from './types.ts';

interface Work {
  loan: Loan;
  /** Payments with the `interestThrough` the entry gave (resolved after replay, when the statement day is final). */
  rawThrough: Map<EntryId, LocalDate | undefined>;
}

const nameKey = (name: string): string => name.trim().toLowerCase();

function nameTaken(loans: ReadonlyMap<LoanId, Work>, name: string, except: LoanId | null): boolean {
  return [...loans.values()].some(({ loan }) => loan.id !== except && !loan.closed && nameKey(loan.name) === nameKey(name));
}

const nameTakenProblem = (name: string): Problem => problem('loan-name-taken', `another loan is already named "${name.trim()}"`);

function applyLoanEntry(book: Book, loans: Map<LoanId, Work>, linked: Map<LotId, EntryId>, byId: ReadonlyMap<EntryId, Entry>, e: LoanRecordEntry, date: LocalDate): Problem | null {
  if (e.kind === 'loan') {
    if (loans.has(e.loan)) return problem('loan-exists', `loan ${e.loan} already exists`);
    if (nameTaken(loans, e.name, null)) return nameTakenProblem(e.name);
    loans.set(e.loan, {
      loan: { id: e.loan, name: e.name.trim(), opened: e.opened, dayCount: e.dayCount ?? 'actual/365', creditLimitCents: e.creditLimitCents ?? null, statementDay: e.statementDay ?? null, closed: false, rates: [{ entryId: e.id, from: e.opened, aprMillionths: e.aprMillionths }], draws: [], payments: [], statements: [] },
      rawThrough: new Map(),
    });
    return null;
  }
  const work = loans.get(e.loan);
  if (work === undefined) return problem('unknown-loan', `loan ${e.loan} does not exist`);
  const l = work.loan;
  switch (e.kind) {
    case 'loan-update': {
      const name = e.name ?? l.name;
      const closed = e.closed ?? l.closed;
      if (!closed && nameTaken(loans, name, l.id)) return nameTakenProblem(name);
      l.name = name.trim();
      l.closed = closed;
      l.creditLimitCents = e.creditLimitCents ?? l.creditLimitCents;
      l.statementDay = e.statementDay ?? l.statementDay;
      if (e.aprMillionths !== undefined) {
        const from = e.rateFrom ?? date;
        // A later record for the same day replaces the earlier one.
        l.rates = [...l.rates.filter((r) => r.from !== from), { entryId: e.id, from, aprMillionths: e.aprMillionths }];
      }
      return null;
    }
    case 'loan-draw': {
      const bad = addVolume(book, 0, e.cents);
      if (bad === null) l.draws.push({ entryId: e.id, date, cents: e.cents, lotId: null });
      return bad;
    }
    case 'loan-link': {
      const lot = book.lots.get(e.lot);
      const origin = lot === undefined ? undefined : byId.get(lot.originEntryId);
      if (lot === undefined || origin === undefined || (origin.kind !== 'buy' && origin.kind !== 'opening-lot')) return problem('unknown-purchase', `${e.lot} is not a purchase or imported lot in the ledger`);
      if (linked.has(lot.id)) return problem('already-linked', 'this purchase is already linked to a loan; unlink it first');
      const cents = e.drawCents ?? origin.costCents;
      const bad = addVolume(book, 0, cents);
      if (bad !== null) return bad;
      linked.set(lot.id, e.id);
      l.draws.push({ entryId: e.id, date: e.drawDate ?? lot.acquiredDate, cents, lotId: lot.id });
      return null;
    }
    case 'loan-payment': {
      const bad = addVolume(book, 0, e.interestCents + e.principalCents);
      if (bad !== null) return bad;
      l.payments.push({ entryId: e.id, date, interestCents: e.interestCents, principalCents: e.principalCents, interestThrough: date });
      work.rawThrough.set(e.id, e.interestThrough);
      return null;
    }
    case 'loan-statement':
      l.statements.push({ entryId: e.id, date, balanceCents: e.balanceCents });
      return null;
  }
}

/**
 * Apply every loan record (loans first, then by `at`, then id) after the coin entries. Problems go to
 * `state.errors` like any other entry's.
 */
export function applyLoanEntries(book: Book, entries: readonly LoanRecordEntry[], byId: ReadonlyMap<EntryId, Entry>): void {
  const loans = new Map<LoanId, Work>();
  const linked = new Map<LotId, EntryId>();
  const ordered = [...entries].sort((a, b) => Number(b.kind === 'loan') - Number(a.kind === 'loan') || compareEntries(a, b));
  for (const e of ordered) {
    const bad = applyLoanEntry(book, loans, linked, byId, e, localDate(e.at, e.tz));
    if (bad === null) book.state.applied.push(e.id);
    else book.state.errors.push({ entryId: e.id, ...bad });
  }
  for (const { loan, rawThrough } of loans.values()) {
    loan.rates.sort((a, b) => compareStrings(a.from, b.from));
    loan.draws.sort((a, b) => compareStrings(a.date, b.date) || compareStrings(a.lotId ?? a.entryId, b.lotId ?? b.entryId));
    for (const p of loan.payments) p.interestThrough = rawThrough.get(p.entryId) ?? (loan.statementDay === null ? p.date : latestMonthDay(p.date, loan.statementDay));
    book.state.loans.push(loan);
  }
}
