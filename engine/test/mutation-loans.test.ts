/**
 * Targeted tests added from mutation testing (`npm run mutate`) for loans.ts and loan-book.ts: each pins down
 * behavior a surviving mutant changed. Interest figures are worked by hand: 7.3% APR is 0.02% a day, so $1,000
 * outstanding costs 20 cents a day.
 */
import { describe, expect, test } from 'vitest';
import { statementDayOn } from '../src/loan-book.ts';
import { estimateLoanInterest, formatAprPercent, loanInterestByYear, loanPurchases, loanSummary, parseAprPercent, splitByWeights, suggestLoanPayment } from '../src/loans.ts';
import { replay } from '../src/replay.ts';
import type { Entry } from '../src/types.ts';
import { buy, cents, noon, pick, sats, sell, TZ, wallet } from './helpers.ts';
import { link, loan, payment, statement } from './loan-helpers.ts';

const APR_7_3 = 73_000;
const coins = (...rows: [string, string, string][]): Entry[] => [wallet('ex'), ...rows.map(([id, date, dollars]) => buy(id, 'ex', date, '0.01', dollars))];
const draw = (id: string, loanId: string, date: string, dollars: string): Entry => ({ id, kind: 'loan-draw', at: noon(date), tz: TZ, loan: loanId, cents: cents(dollars) });

describe('APR text', () => {
  test('parse requires the whole text to be a percent', () => {
    expect(parseAprPercent('6.5')).toBe(65_000);
    expect(parseAprPercent(' 7.875% ')).toBe(78_750);
    expect(parseAprPercent('x6.5')).toBeNull();
    expect(parseAprPercent('6.5x')).toBeNull();
    expect(parseAprPercent('1234')).toBeNull();
    expect(parseAprPercent('100')).toBe(1_000_000);
    expect(parseAprPercent('100.0001')).toBeNull();
  });
  test('format drops up to two trailing zeros only at the end', () => {
    expect(formatAprPercent(100_500)).toBe('10.05%');
    expect(formatAprPercent(65_000)).toBe('6.50%');
    expect(formatAprPercent(78_750)).toBe('7.875%');
    expect(formatAprPercent(60_000)).toBe('6.00%');
  });
});

describe('splitByWeights', () => {
  test('left-over cents go to the largest remainders, earlier first on a tie', () => {
    expect(splitByWeights(10, [1n, 2n])).toEqual([3, 7]);
    expect(splitByWeights(1, [1n, 1n])).toEqual([1, 0]);
    expect(splitByWeights(2, [1n, 1n, 1n])).toEqual([1, 1, 0]);
    expect(splitByWeights(5, [1n, 1n, 1n, 2n])).toEqual([1, 1, 1, 2]);
  });
});

describe('interest estimates by hand', () => {
  const entries = [...coins(['A', '2025-01-01', '1000']), loan('h', '2025-01-01', APR_7_3), link('K', 'h', 'A'), payment('Y1', 'h', '2025-01-06', '0', '500')];
  const state = replay(entries);
  test('a repayment from its day on lowers the daily interest', () => {
    // Jan 1-5 on $1,000 (5 x 20c) and Jan 6-10 on $500 (5 x 10c)
    expect(estimateLoanInterest(state, 'h', '2025-01-01', '2025-01-10')).toBe(150);
    expect(estimateLoanInterest(state, 'h', '2025-01-01', '2025-01-05')).toBe(100);
  });
  test('an empty or backwards period, and an unknown loan, cost nothing', () => {
    expect(estimateLoanInterest(state, 'h', '2025-01-10', '2025-01-09')).toBe(0);
    expect(estimateLoanInterest(state, 'h', '2025-01-10', '2025-01-10')).toBe(10);
    expect(estimateLoanInterest(state, 'nope', '2025-01-01', '2025-01-10')).toBe(0);
  });
  test('the loan is found by id among several', () => {
    const two = replay([...entries, loan('g', '2025-01-01', 0, { name: 'Other' })]);
    expect(estimateLoanInterest(two, 'h', '2025-01-01', '2025-01-05')).toBe(100);
    expect(estimateLoanInterest(two, 'g', '2025-01-01', '2025-01-05')).toBe(0);
    expect(loanSummary(two, 'g', null, '2025-01-05')?.name).toBe('Other');
    expect(loanPurchases(two, 'g', null, '2025-01-05')).toEqual([]);
    expect(loanSummary(two, 'nope', null, '2025-01-05')).toBeNull();
    expect(suggestLoanPayment(two, 'nope', '2025-01-05')).toBeNull();
  });
});

describe('payment suggestions', () => {
  const base = [...coins(['A', '2025-01-01', '1000']), loan('h', '2025-01-01', APR_7_3), link('K', 'h', 'A')];
  test('a principal-only payment does not move the start of the next cycle', () => {
    const state = replay([...base, payment('Y1', 'h', '2025-01-11', '20', '0', { interestThrough: '2025-01-10' }), payment('Y2', 'h', '2025-01-15', '0', '100')]);
    expect(suggestLoanPayment(state, 'h', '2025-01-31')).toMatchObject({ fromDate: '2025-01-11', throughDate: '2025-01-31', alreadyPaidCents: 0 });
  });
  test('a payment already covering the cycle\'s last day counts as already paid, not as an earlier cycle', () => {
    const state = replay([...base, payment('Y1', 'h', '2025-01-11', '20', '0', { interestThrough: '2025-01-10' }), payment('Y2', 'h', '2025-01-31', '5', '0', { interestThrough: '2025-01-31' })]);
    expect(suggestLoanPayment(state, 'h', '2025-01-31')).toMatchObject({ fromDate: '2025-01-11', throughDate: '2025-01-31', days: 21, alreadyPaidCents: 500 });
  });
  test('the cycle starts the day after the latest covered day, whatever order the payments were made in', () => {
    const state = replay([...base, payment('Y1', 'h', '2025-01-20', '20', '0', { interestThrough: '2025-01-12' }), payment('Y2', 'h', '2025-01-25', '10', '0', { interestThrough: '2025-01-08' })]);
    expect(suggestLoanPayment(state, 'h', '2025-01-31')).toMatchObject({ fromDate: '2025-01-13', throughDate: '2025-01-31' });
  });
  test('the cycle starts at a draw dated on its last day even if that is before the loan opened', () => {
    const state = replay([...coins(['A', '2025-01-15', '1000']), loan('h', '2025-02-01', APR_7_3), link('K', 'h', 'A')]);
    expect(suggestLoanPayment(state, 'h', '2025-01-15')).toMatchObject({ fromDate: '2025-01-15', throughDate: '2025-01-15' });
  });
  test('draws after the cycle do not pull its start earlier', () => {
    const state = replay([...coins(['A', '2025-04-01', '1000']), loan('h', '2025-06-01', APR_7_3), link('K', 'h', 'A')]);
    expect(suggestLoanPayment(state, 'h', '2025-03-01')).toMatchObject({ fromDate: '2025-06-01', throughDate: '2025-03-01', days: 0, interestCents: 0 });
  });
});

describe('interest split between purchases', () => {
  test('a payment is split by what each draw generated over the days it covers, even when summarised before its last day', () => {
    // A: $1,000 from Jan 1 (31 days to Jan 31); B: $1,000 from Jan 22 (10 days). $41.00 of interest through Jan 31.
    const state = replay([...coins(['A', '2025-01-01', '1000'], ['B', '2025-01-22', '1000']), loan('h', '2025-01-01', APR_7_3), link('KA', 'h', 'A'), link('KB', 'h', 'B'), payment('Y1', 'h', '2025-01-25', '41', '0', { interestThrough: '2025-01-31' })]);
    expect(loanPurchases(state, 'h', null, '2025-01-25').map((p) => [p.lotId, p.interestShareCents])).toEqual([['A', 3100], ['B', 1000]]);
    expect(loanPurchases(state, 'h', null, '2025-02-15').map((p) => [p.lotId, p.interestShareCents])).toEqual([['A', 3100], ['B', 1000]]);
  });
  test('payments whose covered days are out of order are still split period by period', () => {
    // Y1 (paid Jan 20) covers through Jan 31 and Y2 (paid Jan 25) covers through Jan 15: periods are cut in date order.
    const state = replay([...coins(['A', '2025-01-01', '1000']), loan('h', '2025-01-01', APR_7_3), link('KA', 'h', 'A'), payment('Y1', 'h', '2025-01-20', '12', '0', { interestThrough: '2025-01-31' }), payment('Y2', 'h', '2025-01-25', '3', '0', { interestThrough: '2025-01-15' })]);
    const s = loanSummary(state, 'h', null, '2025-02-10');
    expect(s).toMatchObject({ interestPaidCents: 1500, interestPaidThrough: '2025-01-31', accruedFrom: '2025-02-01', accruedInterestCents: 200, interestOnPurchasesCents: 1500, unallocatedInterestCents: 0 });
  });
  test('payments covering days out of order are split period by period, in date order', () => {
    // A: $1,000 from Jan 1; B: $1,000 from Jan 16. Y1 (paid Jan 20) covers Jan 16-31 and splits evenly;
    // Y2 (paid Jan 25) covers Jan 1-15, when only A was borrowed.
    const state = replay([...coins(['A', '2025-01-01', '1000'], ['B', '2025-01-16', '1000']), loan('h', '2025-01-01', APR_7_3), link('KA', 'h', 'A'), link('KB', 'h', 'B'), payment('Y1', 'h', '2025-01-20', '12', '0', { interestThrough: '2025-01-31' }), payment('Y2', 'h', '2025-01-25', '3', '0', { interestThrough: '2025-01-15' })]);
    expect(loanPurchases(state, 'h', null, '2025-02-10').map((p) => [p.lotId, p.interestShareCents])).toEqual([['A', 900], ['B', 600]]);
  });
  test('with a 0% rate the draws made by the last covered day (that day included) share the interest by amount', () => {
    const state = replay([...coins(['A', '2025-01-01', '1000'], ['B', '2025-01-10', '1000']), loan('h', '2025-01-01', 0), link('KA', 'h', 'A'), link('KB', 'h', 'B'), payment('Y1', 'h', '2025-01-12', '1', '0', { interestThrough: '2025-01-10' })]);
    expect(loanPurchases(state, 'h', null, '2025-01-12').map((p) => p.interestShareCents)).toEqual([50, 50]);
  });
});

describe('loan summary details', () => {
  test('interest paid through is the latest day covered by a payment that paid interest, however payments are ordered', () => {
    const state = replay([...coins(['A', '2025-01-01', '1000']), loan('h', '2025-01-01', APR_7_3), link('KA', 'h', 'A'), payment('Y1', 'h', '2025-01-20', '12', '0', { interestThrough: '2025-01-31' }), payment('Y2', 'h', '2025-01-25', '0', '100', { interestThrough: '2025-01-25' }), payment('Y3', 'h', '2025-01-26', '1', '0', { interestThrough: '2025-01-15' })]);
    expect(loanSummary(state, 'h', null, '2025-02-01')?.interestPaidThrough).toBe('2025-01-31');
    // only a principal payment: nothing paid through
    const onlyPrincipal = replay([...coins(['A', '2025-01-01', '1000']), loan('h', '2025-01-01', APR_7_3), link('KA', 'h', 'A'), payment('Y2', 'h', '2025-01-25', '0', '100', { interestThrough: '2025-01-25' })]);
    expect(loanSummary(onlyPrincipal, 'h', null, '2025-02-01')?.interestPaidThrough).toBeNull();
  });
  test('a statement is checked on its own day, against the draws and payments of that day', () => {
    const state = replay([...coins(['A', '2025-01-01', '1000']), loan('h', '2025-01-01', APR_7_3), link('KA', 'h', 'A'), payment('Y1', 'h', '2025-01-05', '0', '400'), statement('S1', 'h', '2025-01-01', '1000'), statement('S2', 'h', '2025-01-05', '600')]);
    const s = loanSummary(state, 'h', null, '2025-01-05');
    expect(s?.statements.map((x) => [x.date, x.recordedCents, x.differenceCents, x.matches])).toEqual([['2025-01-01', 100_000, 0, true], ['2025-01-05', 60_000, 0, true]]);
    // a statement dated after the summary date is left out
    expect(loanSummary(state, 'h', null, '2025-01-04')?.statements).toHaveLength(1);
  });
  test('coins sold by spending count as sold; frozen coins count toward the purchase\'s coins and cost', () => {
    const state = replay([
      wallet('ex'), wallet('lend'),
      buy('A', 'ex', '2025-01-01', '1', '1000'), buy('B', 'lend', '2025-01-02', '1', '1000'),
      sell('S', 'ex', '2025-02-01', [pick('A', '0.25')], '300', true),
      { id: 'F', kind: 'wallet-freeze', at: noon('2025-03-01'), tz: TZ, wallet: 'lend' },
      loan('h', '2025-01-01', APR_7_3), link('KA', 'h', 'A'), link('KB', 'h', 'B'),
    ]);
    const [a, b] = loanPurchases(state, 'h', null, '2025-04-01');
    expect(a).toMatchObject({ lotId: 'A', soldSats: sats('0.25'), proceedsCents: cents('300'), soldCostCents: cents('250'), heldSats: sats('0.75'), sats: sats('1'), costCents: cents('1000') });
    expect(b).toMatchObject({ lotId: 'B', frozenSats: sats('1'), heldSats: 0, sats: sats('1'), costCents: cents('1000'), otherGoneSats: 0 });
    expect(loanSummary(state, 'h', null, '2025-04-01')).toMatchObject({ frozenSats: sats('1'), soldSats: sats('0.25'), purchasesCostCents: cents('2000') });
  });
  test('interest by year is oldest first even when the first loan paid in a later year', () => {
    const state = replay([
      ...coins(['A', '2025-01-01', '1000'], ['B', '2024-01-01', '1000']),
      // the loan created first paid in the later year, so years are met out of order
      loan('l25', '2023-01-01', APR_7_3, { name: 'Late' }), loan('l24', '2024-01-01', APR_7_3, { name: 'Early' }),
      link('KA', 'l25', 'A'), link('KB', 'l24', 'B'),
      payment('Y25', 'l25', '2025-01-31', '6.2'), payment('Y24', 'l24', '2024-01-31', '6.2'),
    ]);
    expect(loanInterestByYear(state).map((y) => [y.year, y.interestPaidCents, y.loans.map((l) => l.name)])).toEqual([[2024, 620, ['Early']], [2025, 620, ['Late']]]);
    expect(loanInterestByYear(state, 'l25').map((y) => y.year)).toEqual([2025]);
  });
});

describe('loan records in replay', () => {
  test('names are stored and quoted trimmed', () => {
    const state = replay([loan('a', '2025-01-01', APR_7_3, { name: '  HELOC  ' }), loan('b', '2025-01-01', APR_7_3, { name: ' heloc ' })]);
    expect(state.loans.map((l) => l.name)).toEqual(['HELOC']);
    expect(state.errors).toEqual([{ entryId: 'loan-b', code: 'loan-name-taken', message: 'another loan is already named "heloc"' }]);
    const renamed = replay([loan('a', '2025-01-01', APR_7_3), { id: 'u', kind: 'loan-update', at: noon('2025-02-01'), tz: TZ, loan: 'a', name: '  Car loan ' }]);
    expect(renamed.loans[0]?.name).toBe('Car loan');
    const clash = replay([loan('a', '2025-01-01', APR_7_3), loan('b', '2025-01-01', APR_7_3, { name: 'Other' }), { id: 'u', kind: 'loan-update', at: noon('2025-02-01'), tz: TZ, loan: 'b', name: ' heloc ' }]);
    expect(clash.errors).toEqual([{ entryId: 'u', code: 'loan-name-taken', message: 'another loan is already named "heloc"' }]);
  });
  test('an update dated before a loan whose creation fails is reported, never dropped without a word', () => {
    const early = { id: 'a-early', kind: 'loan-update', at: noon('2024-12-01'), tz: TZ, loan: 'b', creditLimitCents: 5 } as const;
    const state = replay([loan('a', '2025-01-01', APR_7_3), loan('b', '2025-01-01', APR_7_3), early]);
    expect(state.errors.map((e) => [e.entryId, e.code])).toEqual([
      ['loan-b', 'loan-name-taken'],
      ['a-early', 'unknown-loan'],
    ]);
    expect(state.applied).not.toContain('a-early');
    expect(state.loans.map((l) => l.id)).toEqual(['a']);
  });
  test('an early update keeps waiting through a failed creation and applies to a later one that works', () => {
    const early = { id: 'a-early', kind: 'loan-update', at: noon('2024-12-01'), tz: TZ, loan: 'b', creditLimitCents: 5 } as const;
    const retry = { ...loan('b', '2025-02-01', APR_7_3, { name: 'Car loan' }), id: 'loan-b2' };
    const state = replay([loan('a', '2025-01-01', APR_7_3), loan('b', '2025-01-01', APR_7_3), retry, early]);
    expect(state.errors.map((e) => [e.entryId, e.code])).toEqual([['loan-b', 'loan-name-taken']]);
    expect(state.applied).toContain('a-early');
    expect(state.loans.find((l) => l.id === 'b')).toMatchObject({ name: 'Car loan', creditLimitCents: 5 });
  });
  test('every loan record is applied exactly once', () => {
    const state = replay([...coins(['A', '2025-01-01', '1000']), loan('h', '2025-01-01', APR_7_3), link('K', 'h', 'A'), draw('D', 'h', '2025-01-02', '10'), payment('Y', 'h', '2025-01-03', '1'), statement('S', 'h', '2025-01-03', '1010')]);
    expect(state.applied.filter((id) => ['D', 'Y', 'S', 'K', 'loan-h'].includes(id)).sort()).toEqual(['D', 'K', 'S', 'Y', 'loan-h']);
  });
  test('statement days are kept in date order even when an update dated before the loan arrives', () => {
    const early = { id: 'u', kind: 'loan-update', at: noon('2024-12-01'), tz: TZ, loan: 'h', statementDay: 15 } as const;
    const state = replay([loan('h', '2025-01-01', APR_7_3, { statementDay: 20 }), early]);
    expect(state.loans[0]?.statementDays.map((d) => [d.from, d.day])).toEqual([['2024-12-01', 15], ['2025-01-01', 20]]);
  });
  test('a statement day takes effect on its own date', () => {
    const loanWith = { statementDays: [{ entryId: 'a', from: '2025-01-01', day: 15 }, { entryId: 'b', from: '2025-03-20', day: 28 }] };
    expect(statementDayOn(loanWith, '2025-03-19')).toBe(15);
    expect(statementDayOn(loanWith, '2025-03-20')).toBe(28);
    expect(statementDayOn(loanWith, '2024-01-01')).toBe(15);
    expect(statementDayOn({ statementDays: [] }, '2025-03-20')).toBeNull();
  });
  test('draws and payments past the ledger cap are refused and not recorded', () => {
    const MAX = 100_000_000_000_000;
    const draws: Entry[] = Array.from({ length: 46 }, (_, i) => ({ id: `d${String(i).padStart(3, '0')}`, kind: 'loan-draw', at: noon('2025-01-02'), tz: TZ, loan: 'h', cents: MAX }));
    const drawn = replay([loan('h', '2025-01-01', APR_7_3), ...draws]);
    expect(drawn.loans[0]?.draws).toHaveLength(45);
    expect(drawn.errors.map((e) => [e.entryId, e.code])).toEqual([['d045', 'out-of-range']]);
    // a payment adds interest and principal together: 22 of $2 trillion fit, the 23rd does not
    const pays: Entry[] = Array.from({ length: 23 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}`, kind: 'loan-payment', at: noon('2025-01-03'), tz: TZ, loan: 'h', interestCents: MAX, principalCents: MAX }));
    const paid = replay([loan('h', '2025-01-01', APR_7_3), ...pays]);
    expect(paid.loans[0]?.payments).toHaveLength(22);
    expect(paid.errors.map((e) => [e.entryId, e.code])).toEqual([['p022', 'out-of-range']]);
  });
});
