/** Fixes from an independent review of the loan figures (docs/loans-spec.md). All data here is made up. */
import { describe, expect, test } from 'vitest';
import { LOAN_PAID_SO_FAR_NOTE, loanInterestByYear, loanSummary, suggestLoanPayment } from '../src/loans.ts';
import { replay } from '../src/replay.ts';
import type { DeleteEntry, Entry, LoanUpdateEntry } from '../src/types.ts';
import { buy, cents, noon, sats, TZ, wallet } from './helpers.ts';
import { link, loan, payment } from './loan-helpers.ts';

const PRICE = cents('100000');
const opening = (id: string, acquired: string, btc: string, dollars: string): Entry => ({ id, kind: 'opening-lot', at: noon('2024-01-01'), tz: TZ, wallet: 'ex', acquiredAt: noon(acquired), sats: sats(btc), costCents: cents(dollars), tier: 'documented', origin: 'Import' });
const del = (id: string, replaces: string): DeleteEntry => ({ id, kind: 'delete', at: noon('2025-06-01'), tz: TZ, replaces, reason: 'Removed' });

describe('a payoff in the middle of a statement cycle', () => {
  // Example P's loan: $10,000.00 from 2025-01-01 at 7.30% ($2.00 a day), statement closing day 31; January's $62.00 paid.
  const base = (): Entry[] => [wallet('ex'), buy('A', 'ex', '2025-01-01', '0.1', '10000'), loan('h', '2025-01-01', 73_000, { statementDay: 31 }), link('K', 'h', 'A'), payment('Y1', 'h', '2025-02-20', '62')];

  test('paying the principal and the interest to date leaves nothing owed, ever after', () => {
    // 2025-03-15: $10,000.00 principal + $86.00 interest (February's $56.00 and March 1-15, as the payoff quote said).
    // A payoff's interest runs through its own day, not the Feb 28 statement, so March 1-14 is paid too.
    const state = replay([...base(), payment('Y2', 'h', '2025-03-15', '86', '10000')]);
    for (const day of ['2025-03-15', '2025-04-30', '2026-11-21']) {
      expect(loanSummary(state, 'h', PRICE, day)).toMatchObject({ principalOwedCents: 0, unpaidBilledInterestCents: 0, accruedInterestCents: 0, owedNowCents: 0, owedNowEstimated: false });
    }
    const s = loanSummary(state, 'h', PRICE, '2026-11-21');
    expect(s?.payoffLeftoverSats).toBe(s?.heldSats);
  });

  test('a payoff pays interest through its own day: what it did not pay of those days is still owed', () => {
    // $80.00 of interest for Feb 1 - Mar 15 ($56.00 + $28.00): $4.00 is still owed, and nothing more accrues.
    const state = replay([...base(), payment('Y2', 'h', '2025-03-15', '80', '10000')]);
    expect(state.loans[0]?.payments.map((p) => p.interestThrough)).toEqual(['2025-01-31', '2025-03-15']);
    expect(loanSummary(state, 'h', PRICE, '2026-11-21')).toMatchObject({ principalOwedCents: 0, unpaidBilledInterestCents: 400, accruedInterestCents: 0, owedNowCents: 400 });
    // Only a payment that leaves nothing owed: a partial principal payment still pays the last closed cycle.
    const partial = replay([...base(), payment('Y2', 'h', '2025-03-15', '56', '5000')]);
    expect(partial.loans[0]?.payments.map((p) => p.interestThrough)).toEqual(['2025-01-31', '2025-02-28']);
  });
});

describe('"interest paid so far" from a mid-stream setup', () => {
  // $20,000.00 drawn 2024-01-15 at 7.875%, statement day 20; tracking starts 2026-11-20 with $3,500.00 paid so far
  // (the model, at today's rate only, says more was charged).
  const soFar = { ...payment('Y0', 'h', '2026-11-20', '3500'), note: LOAN_PAID_SO_FAR_NOTE };
  const base = (): Entry[] => [wallet('ex'), buy('A', 'ex', '2024-01-15', '0.5', '20000'), loan('h', '2024-01-15', 78_750, { statementDay: 20 }), link('K', 'h', 'A')];

  test('settles every cycle through its last day: no made-up unpaid interest', () => {
    const state = replay([...base(), soFar]);
    expect(loanSummary(state, 'h', PRICE, '2026-11-20')).toMatchObject({ principalOwedCents: 2_000_000, unpaidBilledInterestCents: 0, accruedInterestCents: 0, owedNowCents: 2_000_000 });
    // The next cycle counts as usual: Nov 21 - Dec 20 is $129.45; paying $100.00 of it leaves $29.45 unpaid.
    const later = replay([...base(), soFar, payment('Y1', 'h', '2026-12-20', '100')]);
    expect(loanSummary(later, 'h', PRICE, '2026-12-20')).toMatchObject({ unpaidBilledInterestCents: 2_945, accruedInterestCents: 0 });
    // The same payment without the note is an ordinary payment: the model's history beyond it is still billed.
    const plain = replay([...base(), payment('Y0', 'h', '2026-11-20', '3500')]);
    expect(loanSummary(plain, 'h', PRICE, '2026-11-20')?.unpaidBilledInterestCents).toBeGreaterThan(0);
  });

  test('is not put in the year it was recorded: every year it spans lists it, not split', () => {
    const state = replay([...base(), soFar, payment('Y1', 'h', '2026-12-20', '129.45')]);
    const lump = { loanId: 'h', name: 'HELOC', date: '2026-11-20', interestPaidCents: 350_000, onPurchasesCents: 350_000 };
    expect(loanInterestByYear(state)).toEqual([
      { year: 2024, interestPaidCents: 0, onPurchasesCents: 0, loans: [], paidBefore: [lump] },
      { year: 2025, interestPaidCents: 0, onPurchasesCents: 0, loans: [], paidBefore: [lump] },
      { year: 2026, interestPaidCents: 12_945, onPurchasesCents: 12_945, loans: [{ loanId: 'h', name: 'HELOC', interestPaidCents: 12_945, onPurchasesCents: 12_945 }], paidBefore: [lump] },
    ]);
  });
});

describe('a loan-funded purchase that is removed', () => {
  // P1 and P2 linked at $10,000.00 each, $5,000.00 repaid.
  const base = (): Entry[] => [wallet('ex'), buy('P1', 'ex', '2025-01-10', '0.1', '10000'), buy('P2', 'ex', '2025-01-20', '0.1', '10000'), loan('h', '2025-01-01', 65_000), link('K1', 'h', 'P1'), payment('Y', 'h', '2025-03-01', '0', '5000')];

  test('its draw keeps counting (as an other draw) when the link says how much and when', () => {
    const kept = { ...link('K2b', 'h', 'P2', { drawCents: cents('10000'), drawDate: '2025-01-20' }), replaces: 'K2', reason: 'Its purchase was removed' };
    const state = replay([...base(), link('K2', 'h', 'P2'), kept, del('Z', 'P2')]);
    expect(state.errors).toEqual([]);
    expect(loanSummary(state, 'h', PRICE, '2025-06-01')).toMatchObject({ drawnCents: 2_000_000, principalOwedCents: 1_500_000, otherDrawsCents: 1_000_000, purchaseCount: 1 });
    expect(state.loans[0]?.draws.find((d) => d.entryId === 'K2b')).toMatchObject({ date: '2025-01-20', lotId: null, lotIds: [] });
  });

  test('a link without its amount and date stays inert, as before (nothing to count)', () => {
    const state = replay([...base(), link('K2', 'h', 'P2'), del('Z', 'P2'), link('K3', 'h', 'P2', { drawCents: 100 })]);
    expect(Object.fromEntries(state.errors.map((e) => [e.entryId, e.code]))).toEqual({ K2: 'unknown-purchase', K3: 'unknown-purchase' });
  });

  test('one row of an imported purchase removed: the link keeps its whole draw on the rows left', () => {
    const rows: Entry[] = [wallet('ex'), opening('L1', '2024-03-01', '0.1', '6000'), opening('L2', '2024-03-01', '0.1', '6000'), loan('h', '2024-01-01', 65_000)];
    const k = link('K', 'h', 'L1', { alsoLots: ['L2'], drawCents: cents('12000'), drawDate: '2024-03-01' });
    const state = replay([...rows, k, del('Z', 'L2')]);
    expect(state.errors).toEqual([]);
    expect(state.loans[0]?.draws).toEqual([{ entryId: 'K', date: '2024-03-01', cents: 1_200_000, lotId: 'L1', lotIds: ['L1'] }]);
    expect(loanSummary(state, 'h', PRICE, '2024-06-01')).toMatchObject({ principalOwedCents: 1_200_000, purchaseCount: 1 });
  });
});

describe('the payment pre-fill after the statement day changed', () => {
  test('never asks again for days a payment already covers', () => {
    // Statement day 15: the Nov 16 payment covers Oct 16 - Nov 15 ($62.00). The day becomes the month end on Nov 18.
    const up: LoanUpdateEntry = { id: 'U', kind: 'loan-update', at: noon('2025-11-18'), tz: TZ, loan: 'h', statementDay: 31 };
    const state = replay([wallet('ex'), buy('A', 'ex', '2025-01-01', '0.1', '10000'), loan('h', '2025-01-01', 73_000, { statementDay: 15 }), link('K', 'h', 'A'), payment('Y1', 'h', '2025-10-20', '10'), payment('Y2', 'h', '2025-11-16', '62'), up]);
    expect(suggestLoanPayment(state, 'h', '2025-11-20')).toMatchObject({ fromDate: '2025-10-16', throughDate: '2025-11-15', alreadyPaidCents: 6_200, interestCents: 0 });
    // Once the new month-end statement closes, the next cycle starts after the last day paid.
    expect(suggestLoanPayment(state, 'h', '2025-12-05')).toMatchObject({ fromDate: '2025-11-16', throughDate: '2025-11-30', alreadyPaidCents: 0, interestCents: 3_000 });
  });
});
