/** Builders for synthetic loan test entries (docs/loans-spec.md, Example L). All data here is made up. */
import type { Entry, LoanEntry, LoanLinkEntry, LoanPaymentEntry, LoanStatementEntry, LoanUpdateEntry } from '../src/types.ts';
import { buy, cents, move, noon, pick, sats, sell, TZ, wallet } from './helpers.ts';

export function loan(id: string, opened: string, aprMillionths: number, extra: Partial<LoanEntry> = {}): LoanEntry {
  return { id: `loan-${id}`, kind: 'loan', at: noon(opened), tz: TZ, loan: id, name: 'HELOC', opened, aprMillionths, ...extra };
}

export function rate(id: string, loanId: string, from: string, aprMillionths: number): LoanUpdateEntry {
  return { id, kind: 'loan-update', at: noon(from), tz: TZ, loan: loanId, aprMillionths, rateFrom: from };
}

export function link(id: string, loanId: string, lot: string, extra: Partial<LoanLinkEntry> = {}): LoanLinkEntry {
  return { id, kind: 'loan-link', at: '2025-12-01T19:00:00Z', tz: TZ, loan: loanId, lot, ...extra };
}

export function payment(id: string, loanId: string, date: string, interest: string, principal = '0', extra: Partial<LoanPaymentEntry> = {}): LoanPaymentEntry {
  return { id, kind: 'loan-payment', at: noon(date), tz: TZ, loan: loanId, interestCents: cents(interest), principalCents: cents(principal), ...extra };
}

export function statement(id: string, loanId: string, date: string, balance: string): LoanStatementEntry {
  return { id, kind: 'loan-statement', at: noon(date), tz: TZ, loan: loanId, balanceCents: cents(balance) };
}

/** Example L's coin entries: four $5,000 purchases, a move of P3 and P4 to cold storage (fee from P4), a partial sale of P1. */
export function exampleCoins(): Entry[] {
  return [
    wallet('ex'),
    wallet('cold', 'self-custody'),
    buy('P1', 'ex', '2025-01-06', '0.05', '5000'),
    buy('P2', 'ex', '2025-01-21', '0.04807692', '5000'),
    buy('P3', 'ex', '2025-02-10', '0.05154639', '5000'),
    buy('P4', 'ex', '2025-03-03', '0.05813953', '5000'),
    move('M1', 'ex', 'cold', '2025-03-20', sats('0.10966592'), 2_000, '1.68', [pick('P3', '0.05154639'), pick('P4', '0.05813953')]),
    sell('S1', 'ex', '2025-05-15', [pick('P1', '0.02')], '2060'),
  ];
}

/** Example L's loan records. The monthly interest figures are the engine's own pre-fill (checked by verify_loans.py). */
export function exampleLoan(): Entry[] {
  return [
    loan('h', '2025-01-02', 65_000, { creditLimitCents: cents('50000'), statementDay: 31 }),
    rate('R1', 'h', '2025-04-15', 62_500),
    rate('R2', 'h', '2025-06-01', 65_000),
    link('K1', 'h', 'P1'),
    link('K2', 'h', 'P2'),
    link('K3', 'h', 'P3'),
    link('K4', 'h', 'P4'),
    payment('Y1', 'h', '2025-02-20', '32.95'),
    payment('Y2', 'h', '2025-03-20', '66.78'),
    payment('Y3', 'h', '2025-04-20', '108.63'),
    payment('Y4', 'h', '2025-05-20', '104.66'),
    payment('Y5', 'h', '2025-06-20', '106.16'),
    payment('Y6', 'h', '2025-07-20', '106.85', '1000'),
    statement('T1', 'h', '2025-06-30', '20000'),
    statement('T2', 'h', '2025-07-31', '19000'),
  ];
}
