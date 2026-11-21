/** Loans (docs/loans-spec.md): Example L and C must match exactly (verified by an independent Decimal checker). */
import { describe, expect, test } from 'vitest';
import { dateOfDay, dayNumber, latestMonthDay } from '../src/dates.ts';
import {
  aprOn,
  estimateLoanInterest,
  formatAprPercent,
  loanByPurchase,
  loanInterestByYear,
  loanPurchases,
  loanSummary,
  parseAprPercent,
  splitByWeights,
  suggestLoanPayment,
} from '../src/loans.ts';
import { replay } from '../src/replay.ts';
import { originLotId, traceCoins } from '../src/trace.ts';
import type { Entry, LedgerState, LoanDrawEntry } from '../src/types.ts';
import { parseEntry } from '../src/validate.ts';
import { exportOpeningLotsCsv, importOpeningLotsCsv } from '../src/io.ts';
import { buy, cents, give, lost, move, noon, pick, receive, sats, sell, TZ, wallet } from './helpers.ts';
import { exampleCoins, exampleLoan, link, loan, payment, rate, statement } from './loan-helpers.ts';

const AS_OF = '2025-08-10';
const PRICE = cents('95000');

function draw(id: string, loanId: string, date: string, dollars: string): LoanDrawEntry {
  return { id, kind: 'loan-draw', at: noon(date), tz: TZ, loan: loanId, cents: cents(dollars) };
}

function codes(state: LedgerState): Record<string, string> {
  return Object.fromEntries(state.errors.map((e) => [e.entryId, e.code]));
}

describe('Example L: four $5,000 purchases on a 6.5% HELOC', () => {
  const state = replay([...exampleCoins(), ...exampleLoan()]);

  test('replays without errors', () => {
    expect(state.errors).toEqual([]);
    expect(state.loans).toHaveLength(1);
  });

  test('the payment pre-fill is each month’s interest on the day-end balance (partial first month, rate change mid-April)', () => {
    const payDates = ['2025-02-20', '2025-03-20', '2025-04-20', '2025-05-20', '2025-06-20', '2025-07-20'];
    const expected = [
      ['2025-01-02', '2025-01-31', 30, 3_295, 1_000_000],
      ['2025-02-01', '2025-02-28', 28, 6_678, 1_500_000],
      ['2025-03-01', '2025-03-31', 31, 10_863, 2_000_000],
      ['2025-04-01', '2025-04-30', 30, 10_466, 2_000_000],
      ['2025-05-01', '2025-05-31', 31, 10_616, 2_000_000],
      ['2025-06-01', '2025-06-30', 30, 10_685, 2_000_000],
    ];
    payDates.forEach((d, i) => {
      // As it looked before that payment was logged.
      const before = replay([...exampleCoins(), ...exampleLoan().filter((e) => !(e.kind === 'loan-payment' && e.at.slice(0, 10) >= d))]);
      const s = suggestLoanPayment(before, 'h', d);
      const [fromDate, throughDate, days, interestCents, principalOwedCents] = expected[i] as [string, string, number, number, number];
      expect(s).toMatchObject({ fromDate, throughDate, days, interestCents, principalOwedCents });
    });
    expect(suggestLoanPayment(state, 'h', '2025-05-20')?.aprMillionths).toBe(62_500);
  });

  test('summary as of 2025-08-10 at $95,000', () => {
    const s = loanSummary(state, 'h', PRICE, AS_OF);
    expect(s).toMatchObject({
      name: 'HELOC',
      aprMillionths: 65_000,
      dayCount: 'actual/365',
      drawnCents: 2_000_000,
      purchasesDrawnCents: 2_000_000,
      otherDrawsCents: 0,
      principalRepaidCents: 100_000,
      principalOwedCents: 1_900_000,
      creditCents: 0,
      interestPaidCents: 52_603,
      interestPaidThrough: '2025-06-30',
      accruedInterestCents: 14_211,
      accruedFrom: '2025-07-01',
      owedNowCents: 1_914_211,
      owedNowEstimated: true,
      creditLimitCents: 5_000_000,
      availableCreditCents: 3_100_000,
      purchaseCount: 4,
      purchasesCostCents: 2_000_000,
      heldSats: 18_774_284,
      heldCostCents: 1_799_828,
      frozenSats: 0,
      soldSats: 2_000_000,
      soldCostCents: 200_000,
      proceedsCents: 206_000,
      otherGoneSats: 2_000,
      valueCents: 1_783_558,
      upDownCents: -16_270,
      interestOnPurchasesCents: 52_603,
      interestOnPurchasesEstimated: false,
      unallocatedInterestCents: 0,
      recoveredCents: 0,
      gainIncludingInterestCents: -68_873,
      overallResultCents: -63_045,
      breakEvenPriceCents: 9_866_853,
      payoffPriceCents: 10_195_921,
      payoffLeftoverSats: -1_375_306,
      payoffLeftoverPrincipalOnlySats: -1_225_716,
    });
    expect(s?.statements.map((x) => [x.date, x.recordedCents, x.differenceCents, x.matches])).toEqual([
      ['2025-06-30', 2_000_000, 0, true],
      ['2025-07-31', 1_900_000, 0, true],
    ]);
  });

  test('per purchase: value, up/down, estimated interest share; shares add back to the interest paid', () => {
    const rows = loanPurchases(state, 'h', PRICE, AS_OF);
    expect(rows.map((p) => [p.lotId, p.heldSats, p.heldCostCents, p.valueCents, p.upDownCents, p.interestShareCents, p.gainIncludingInterestCents])).toEqual([
      ['P1', 3_000_000, 300_000, 285_000, -15_000, 15_512, -30_512],
      ['P2', 4_807_692, 500_000, 456_731, -43_269, 14_175, -57_444],
      ['P3', 5_154_639, 500_000, 489_691, -10_309, 12_393, -22_702],
      ['P4', 5_811_953, 499_828, 552_136, 52_308, 10_523, 41_785],
    ]);
    expect(rows.reduce((s, p) => s + p.interestShareCents, 0)).toBe(52_603);
    expect(rows.reduce((s, p) => s + (p.valueCents as number), 0)).toBe(1_783_558);
    const p1 = rows[0];
    expect(p1).toMatchObject({ drawDate: '2025-01-06', drawCents: 500_000, sats: 5_000_000, costCents: 500_000, soldSats: 2_000_000, soldCostCents: 200_000, proceedsCents: 206_000, otherGoneSats: 0 });
    expect(rows[3]).toMatchObject({ sats: 5_813_953, costCents: 500_000, otherGoneSats: 2_000, recoveredCents: 0 });
    expect(rows[3]?.gone).toEqual([{ kind: 'fees', entryId: 'M1', date: '2025-03-20', lotId: 'P4', sats: 2_000, costCents: 172, proceedsCents: 0 }]);
  });

  test('interest by year for the CPA note; which loan paid for which purchase', () => {
    expect(loanInterestByYear(state)).toEqual([{ year: 2025, interestPaidCents: 52_603, onPurchasesCents: 52_603, loans: [{ loanId: 'h', name: 'HELOC', interestPaidCents: 52_603, onPurchasesCents: 52_603 }] }]);
    expect(loanByPurchase(state)).toEqual(new Map([['P1', 'h'], ['P2', 'h'], ['P3', 'h'], ['P4', 'h']]));
    expect(originLotId('M1:P4')).toBe('P4');
  });

  test('without a price the value figures are null; the loan figures are not', () => {
    const s = loanSummary(state, 'h', null, AS_OF);
    expect(s).toMatchObject({ valueCents: null, upDownCents: null, gainIncludingInterestCents: null, overallResultCents: null, payoffLeftoverSats: null, payoffLeftoverPrincipalOnlySats: null, owedNowCents: 1_914_211, breakEvenPriceCents: 9_866_853 });
    expect(loanPurchases(state, 'h', null, AS_OF)[0]).toMatchObject({ valueCents: null, upDownCents: null, gainIncludingInterestCents: null });
    expect(loanSummary(state, 'h', 0, AS_OF)?.payoffLeftoverSats).toBeNull();
  });

  test('a past date ignores later records', () => {
    const s = loanSummary(state, 'h', PRICE, '2025-03-25');
    expect(s).toMatchObject({ drawnCents: 2_000_000, interestPaidCents: 3_295 + 6_678, interestPaidThrough: '2025-02-28', accruedFrom: '2025-03-01', principalRepaidCents: 0, statements: [] });
    // Mar 1 - Mar 25 on $20,000 at 6.5%, but P4 only from Mar 3: (15,000 × 2 + 20,000 × 23) × 6.5% / 365 = $87.26.
    expect(s?.accruedInterestCents).toBe(8_726);
  });
});

describe('Example C: interest on a constant balance with a rate history', () => {
  const entries = (dayCount?: 'actual/360'): Entry[] => [
    loan('c', '2025-01-01', 65_000, dayCount === undefined ? {} : { dayCount }),
    draw('D1', 'c', '2025-01-01', '40000'),
    rate('R1', 'c', '2025-03-01', 62_500),
    rate('R2', 'c', '2025-05-01', 65_000),
  ];
  const state = replay(entries());

  test('31 and 30 days at 6.25%, 31 days at 6.50%, and actual/360', () => {
    expect(estimateLoanInterest(state, 'c', '2025-03-01', '2025-03-31')).toBe(21_233);
    expect(estimateLoanInterest(state, 'c', '2025-04-01', '2025-04-30')).toBe(20_548);
    expect(estimateLoanInterest(state, 'c', '2025-05-01', '2025-05-31')).toBe(22_082);
    expect(estimateLoanInterest(replay(entries('actual/360')), 'c', '2025-05-01', '2025-05-31')).toBe(22_389);
  });

  test('a draw (not a purchase) counts toward what is owed; nothing is attributed to coins', () => {
    const s = loanSummary(replay([...entries(), payment('Y', 'c', '2025-02-01', '220.82')]), 'c', PRICE, '2025-02-01');
    expect(s).toMatchObject({ drawnCents: 4_000_000, otherDrawsCents: 4_000_000, purchaseCount: 0, interestOnPurchasesCents: 0, interestOnPurchasesEstimated: true, heldSats: 0, breakEvenPriceCents: null, payoffPriceCents: null, payoffLeftoverSats: -42_105_264, availableCreditCents: null });
  });
});

describe('interest allocation edge cases', () => {
  const coins = (): Entry[] => [wallet('ex'), buy('A', 'ex', '2025-01-10', '0.1', '10000'), buy('B', 'ex', '2025-02-10', '0.1', '10000')];

  test('with a non-purchase draw, the purchases get an estimated share (by dollar-days)', () => {
    const state = replay([...coins(), loan('h', '2025-01-01', 73_000), link('K1', 'h', 'A'), draw('D', 'h', '2025-01-10', '10000'), payment('Y', 'h', '2025-02-01', '100', '0', { interestThrough: '2025-01-31' })]);
    const s = loanSummary(state, 'h', PRICE, '2025-02-01');
    expect(s).toMatchObject({ interestPaidCents: 10_000, interestOnPurchasesCents: 5_000, interestOnPurchasesEstimated: true, otherDrawsCents: 1_000_000 });
    expect(loanInterestByYear(state)).toEqual([{ year: 2025, interestPaidCents: 10_000, onPurchasesCents: 5_000, loans: [{ loanId: 'h', name: 'HELOC', interestPaidCents: 10_000, onPurchasesCents: 5_000 }] }]);
  });

  test('a period with no balance splits by the amounts drawn by then; interest before any draw is left unallocated', () => {
    // A 0% period: nothing generated interest, so split by amount.
    const state = replay([...coins(), loan('h', '2025-01-01', 0), link('K1', 'h', 'A', { drawCents: cents('3000') }), link('K2', 'h', 'B', { drawCents: cents('1000') }), payment('Y', 'h', '2025-03-05', '40', '0', { interestThrough: '2025-03-01' })]);
    expect(loanPurchases(state, 'h', PRICE, '2025-03-05').map((p) => p.interestShareCents)).toEqual([3_000, 1_000]);
    // Interest recorded as paid through a day before any draw: on nothing.
    const early = replay([...coins(), loan('h', '2025-01-01', 65_000), link('K1', 'h', 'A'), payment('Y', 'h', '2025-01-05', '40', '0', { interestThrough: '2025-01-05' })]);
    expect(loanSummary(early, 'h', PRICE, '2025-01-05')).toMatchObject({ interestPaidCents: 4_000, interestOnPurchasesCents: 0, unallocatedInterestCents: 4_000, interestOnPurchasesEstimated: true });
    const none = replay([loan('h', '2025-01-01', 65_000), payment('Y', 'h', '2025-01-31', '12.34')]);
    expect(loanSummary(none, 'h', PRICE, '2025-02-01')).toMatchObject({ interestPaidCents: 1_234, interestOnPurchasesCents: 0, accruedInterestCents: 0, owedNowEstimated: false });
    const zero = replay([...coins(), loan('h', '2025-01-01', 65_000), link('K', 'h', 'A', { drawCents: 0 }), payment('Y', 'h', '2025-01-31', '1')]);
    expect(loanPurchases(zero, 'h', PRICE, '2025-02-01').map((p) => p.interestShareCents)).toEqual([0]);
    expect(loanSummary(zero, 'h', PRICE, '2025-02-01')).toMatchObject({ interestOnPurchasesCents: 0, unallocatedInterestCents: 100 });
    expect(loanInterestByYear(none)).toEqual([{ year: 2025, interestPaidCents: 1_234, onPurchasesCents: 0, loans: [{ loanId: 'h', name: 'HELOC', interestPaidCents: 1_234, onPurchasesCents: 0 }] }]);
  });

  test('two payments for the same period share it; interest paid ahead leaves nothing accrued', () => {
    const state = replay([...coins(), loan('h', '2025-01-01', 65_000), link('K1', 'h', 'A'), link('K2', 'h', 'B'), payment('Y1', 'h', '2025-03-05', '10', '0', { interestThrough: '2025-02-28' }), payment('Y2', 'h', '2025-03-06', '10.01', '0', { interestThrough: '2025-02-28' }), payment('Y3', 'h', '2025-03-07', '5', '0', { interestThrough: '2025-03-31' })]);
    const rows = loanPurchases(state, 'h', PRICE, '2025-03-10');
    expect(rows.reduce((s, p) => s + p.interestShareCents, 0)).toBe(2_501);
    expect(loanSummary(state, 'h', PRICE, '2025-03-10')).toMatchObject({ accruedInterestCents: 0, accruedFrom: null, interestPaidThrough: '2025-03-31', owedNowCents: 2_000_000 });
  });

  test('principal repaid splits across draws in proportion; overpaying leaves a credit that a later draw uses first', () => {
    const state = replay([...coins(), loan('h', '2025-01-01', 65_000, { creditLimitCents: cents('15000') }), link('K1', 'h', 'A'), payment('Y1', 'h', '2025-01-20', '0', '12000'), link('K2', 'h', 'B'), payment('Y2', 'h', '2025-03-31', '50', '0')]);
    expect(loanSummary(state, 'h', PRICE, '2025-01-31')).toMatchObject({ principalOwedCents: 0, creditCents: 200_000, availableCreditCents: 1_700_000, accruedInterestCents: 1_781 });
    const later = loanSummary(state, 'h', PRICE, '2025-03-31');
    // B (Feb 10) uses the $2,000 credit first: $8,000 outstanding, Feb 10 - Mar 31.
    expect(later).toMatchObject({ principalOwedCents: 800_000, creditCents: 0, availableCreditCents: 700_000 });
    expect(loanPurchases(state, 'h', PRICE, '2025-03-31').map((p) => p.interestShareCents)).toEqual([1_000, 4_000]);
  });

  test('a partial principal payment reduces each draw in proportion (largest remainder)', () => {
    const state = replay([...coins(), loan('h', '2025-01-01', 100_000), link('K1', 'h', 'A', { drawCents: 100, drawDate: '2025-01-01' }), link('K2', 'h', 'B', { drawCents: 200, drawDate: '2025-01-01' }), payment('Y1', 'h', '2025-01-02', '0', '0.01'), payment('Y2', 'h', '2025-12-31', '1', '0', { interestThrough: '2025-12-31' })]);
    // After Y1: A 100, B 199 (B has the larger remainder, 2/3 of a cent).
    expect(loanPurchases(state, 'h', PRICE, '2025-12-31').map((p) => p.interestShareCents)).toEqual([33, 67]);
    expect(loanSummary(state, 'h', PRICE, '2025-12-31')?.principalOwedCents).toBe(299);
  });
});

describe('coins traced from a purchase', () => {
  test('moves, sales, spending, gifts (person and charity), losses, frozen wallets and close-outs', () => {
    const entries: Entry[] = [
      wallet('ex'),
      wallet('cold', 'self-custody'),
      wallet('bad'),
      buy('A', 'ex', '2024-01-10', '1', '10000'),
      move('M1', 'ex', 'cold', '2024-02-01', sats('0.5'), 0, '0', [pick('A', '0.5')]),
      move('M2', 'cold', 'bad', '2024-02-02', sats('0.1'), 0, '0', [pick('M1:A', '0.1')]),
      sell('S', 'cold', '2024-03-01', [pick('M1:A', '0.1')], '5000'),
      sell('SP', 'ex', '2024-03-02', [pick('A', '0.1')], '4000', true),
      give('G1', 'ex', '2024-03-03', [pick('A', '0.05')], '1000', 'person', 'Kid'),
      give('G2', 'cold', '2024-03-04', [pick('M1:A', '0.05')], '1000', 'charity', 'Church'),
      lost('L', 'ex', '2024-03-05', [pick('A', '0.05')]),
      { id: 'F', kind: 'wallet-freeze', at: noon('2024-04-01'), tz: TZ, wallet: 'bad' },
    ];
    const t = traceCoins(replay(entries), ['A']);
    expect(t.heldSats).toBe(sats('0.55'));
    expect(t.heldCostCents).toBe(cents('5500'));
    expect(t.frozenSats).toBe(sats('0.1'));
    expect(t.frozenCostCents).toBe(cents('1000'));
    expect(t.gone.map((g) => [g.kind, g.lotId, g.sats, g.proceedsCents])).toEqual([
      ['sold', 'M1:A', sats('0.1'), cents('5000')],
      ['spent', 'A', sats('0.1'), cents('4000')],
      ['given', 'A', sats('0.05'), 0],
      ['given', 'M1:A', sats('0.05'), 0],
      ['lost', 'A', sats('0.05'), 0],
    ]);
    const closed = replay([...entries, { id: 'C', kind: 'wallet-close-out', at: noon('2024-05-01'), tz: TZ, wallet: 'bad', reason: 'Platform failed' }]);
    const t2 = traceCoins(closed, ['A']);
    expect(t2.frozenSats).toBe(0);
    expect(t2.gone.at(-1)).toMatchObject({ kind: 'closed-out', lotId: 'M2:M1:A', sats: sats('0.1'), costCents: cents('1000') });
  });

  test('found by any version id of the entry that created the coins', () => {
    const entries: Entry[] = [wallet('ex'), buy('A', 'ex', '2024-01-10', '1', '10000'), { ...buy('A2', 'ex', '2024-01-10', '2', '10000'), replaces: 'A', reason: 'typo' }];
    expect(traceCoins(replay(entries), ['A2']).heldSats).toBe(sats('2'));
    expect(traceCoins(replay(entries), ['nothing']).heldSats).toBe(0);
  });
});

describe('loan records in replay', () => {
  const coins = (): Entry[] => [wallet('ex'), buy('A', 'ex', '2025-01-10', '0.1', '10000'), receive('I', 'ex', '2025-01-11', '0.001', '100', { type: 'income' }), { id: 'O', kind: 'opening-lot', at: '2020-05-01T12:00:00Z', tz: TZ, wallet: 'ex', acquiredAt: '2020-05-01T12:00:00Z', sats: 1_000, costCents: 99, tier: 'estimated', origin: 'Old exchange' }];

  test('links: buys and opening lots only, at most one loan each, defaults from the purchase', () => {
    const state = replay([...coins(), loan('h', '2025-01-01', 65_000), loan('g', '2025-01-01', 65_000, { id: 'loan-g', name: 'Second line' }), link('K1', 'h', 'A'), link('K2', 'g', 'A'), link('K3', 'h', 'I'), link('K4', 'h', 'missing'), link('K5', 'h', 'O'), link('K6', 'nope', 'A')]);
    expect(codes(state)).toEqual({ K2: 'already-linked', K3: 'unknown-purchase', K4: 'unknown-purchase', K6: 'unknown-loan' });
    expect(state.loans.find((l) => l.id === 'h')?.draws).toEqual([
      { entryId: 'K5', date: '2020-05-01', cents: 99, lotId: 'O', lotIds: ['O'] },
      { entryId: 'K1', date: '2025-01-10', cents: 1_000_000, lotId: 'A', lotIds: ['A'] },
    ]);
  });

  test('loan create, rename, close, reopen, limit, statement day and rate changes', () => {
    const upd = (id: string, date: string, patch: object): Entry => ({ id, kind: 'loan-update', at: noon(date), tz: TZ, loan: 'h', ...patch }) as Entry;
    const state = replay([
      loan('h', '2025-01-01', 65_000),
      loan('h', '2025-01-02', 70_000, { id: 'dup' }),
      loan('g', '2025-01-03', 65_000, { id: 'loan-g', name: ' heloc ' }),
      loan('k', '2025-01-01', 65_000, { id: 'loan-k', name: 'Card' }),
      upd('U1', '2025-02-01', { name: 'Card' }),
      upd('U2', '2025-02-02', { closed: true, creditLimitCents: 100, statementDay: 5 }),
      loan('g2', '2025-02-03', 65_000, { id: 'loan-g2' }),
      upd('U3', '2025-02-04', { closed: false }),
      upd('U4', '2025-02-05', { name: 'Home line', closed: false, aprMillionths: 60_000 }),
      upd('U5', '2025-02-06', { aprMillionths: 61_000, rateFrom: '2025-02-05' }),
      upd('U6', '2025-02-07', { aprMillionths: 50_000, rateFrom: '2024-12-01' }),
    ]);
    // Names are checked in timeline order: g2 takes the name once h is closed, so reopening h under it is refused.
    expect(codes(state)).toEqual({ dup: 'loan-exists', 'loan-g': 'loan-name-taken', U1: 'loan-name-taken', U3: 'loan-name-taken' });
    expect(state.loans.find((l) => l.id === 'g2')?.name).toBe('HELOC');
    expect(state.loans.find((l) => l.id === 'h')?.statementDays).toEqual([{ entryId: 'U2', from: '2025-02-02', day: 5 }]);
    const h = state.loans.find((l) => l.id === 'h');
    expect(h).toMatchObject({ name: 'Home line', closed: false, creditLimitCents: 100, statementDay: 5 });
    expect(h?.rates.map((r) => [r.from, r.aprMillionths])).toEqual([['2024-12-01', 50_000], ['2025-01-01', 65_000], ['2025-02-05', 61_000]]);
    expect(aprOn(h as never, '2024-11-01')).toBe(50_000);
    expect(aprOn(h as never, '2025-03-01')).toBe(61_000);
  });

  test('payments default their "interest through" to the latest statement closing date, else the payment date', () => {
    const state = replay([loan('h', '2025-01-01', 65_000, { statementDay: 5 }), loan('g', '2025-01-01', 65_000, { id: 'loan-g', name: 'Other' }), payment('Y1', 'h', '2025-02-03', '1'), payment('Y2', 'h', '2025-02-05', '1'), payment('Y3', 'g', '2025-02-03', '1'), payment('Y4', 'h', '2025-03-01', '1', '0', { interestThrough: '2025-02-20' })]);
    expect(state.loans.flatMap((l) => l.payments.map((p) => [p.entryId, p.interestThrough]))).toEqual([
      ['Y3', '2025-02-03'],
      ['Y1', '2025-01-05'],
      ['Y2', '2025-02-05'],
      ['Y4', '2025-02-20'],
    ]);
  });

  test('statements report a mismatch with the difference', () => {
    const state = replay([...coins(), loan('h', '2025-01-01', 65_000), link('K', 'h', 'A'), statement('T', 'h', '2025-02-01', '10000.50'), statement('X', 'nope', '2025-02-01', '1')]);
    expect(loanSummary(state, 'h', PRICE, '2025-03-01')?.statements).toEqual([{ entryId: 'T', date: '2025-02-01', balanceCents: 1_000_050, recordedCents: 1_000_000, differenceCents: 50, matches: false }]);
    expect(codes(state)).toEqual({ X: 'unknown-loan' });
  });

  test('loan amounts count toward the ledger limits (out-of-range, never a wrong sum)', () => {
    const huge = 100_000_000_000_000;
    const many = Array.from({ length: 46 }, (_, i) => draw(`D${String(i).padStart(2, '0')}`, 'h', '2025-01-02', '1000000000000'));
    const state = replay([...coins(), loan('h', '2025-01-01', 0), ...many, link('K', 'h', 'A', { drawCents: huge }), payment('Y', 'h', '2025-12-01', '1000000000000', '0')]);
    expect(Object.values(codes(state)).filter((c) => c === 'out-of-range').length).toBeGreaterThanOrEqual(2);
    expect(codes(state)['K']).toBe('out-of-range');
    expect(codes(state)['Y']).toBe('out-of-range');
  });

  test('unknown loans: summary null, purchases empty, estimates 0, no suggestion', () => {
    const state = replay(coins());
    expect(loanSummary(state, 'h', PRICE, AS_OF)).toBeNull();
    expect(loanPurchases(state, 'h', PRICE, AS_OF)).toEqual([]);
    expect(estimateLoanInterest(state, 'h', '2025-01-01', '2025-01-31')).toBe(0);
    expect(suggestLoanPayment(state, 'h', '2025-01-31')).toBeNull();
    expect(loanInterestByYear(replay([loan('h', '2025-01-01', 1)]))).toEqual([]);
  });

  test('estimates: a start after the end is 0; the first suggestion starts at the loan or its first draw', () => {
    const state = replay([...coins(), loan('h', '2025-01-15', 65_000), link('K', 'h', 'A')]);
    expect(estimateLoanInterest(state, 'h', '2025-02-01', '2025-01-31')).toBe(0);
    expect(suggestLoanPayment(state, 'h', '2025-01-31')).toMatchObject({ fromDate: '2025-01-10', throughDate: '2025-01-31', days: 22 });
    const paidAhead = replay([...coins(), loan('h', '2025-01-15', 65_000), link('K', 'h', 'A'), payment('Y', 'h', '2025-01-20', '1', '0', { interestThrough: '2025-03-31' })]);
    expect(suggestLoanPayment(paidAhead, 'h', '2025-01-31')).toMatchObject({ fromDate: '2025-01-10', interestCents: 3_918 });
    expect(suggestLoanPayment(replay([...coins(), loan('h', '2025-01-15', 65_000), payment('Y', 'h', '2025-01-20', '1')]), 'h', '2025-01-20')).toMatchObject({ fromDate: '2025-01-15', days: 6, interestCents: 0 });
  });

  test('interest by year groups payments by the year they were paid, per loan or for one loan', () => {
    const state = replay([...coins(), loan('h', '2024-12-01', 65_000), link('K', 'h', 'A'), payment('Y1', 'h', '2024-12-31', '1'), payment('Y2', 'h', '2025-01-31', '2'), loan('g', '2025-01-01', 65_000, { id: 'loan-g', name: 'Other' }), draw('D', 'g', '2025-01-01', '100'), payment('Y3', 'g', '2025-01-31', '3')]);
    expect(loanInterestByYear(state).map((y) => [y.year, y.interestPaidCents, y.onPurchasesCents, y.loans.length])).toEqual([[2024, 100, 0, 1], [2025, 500, 200, 2]]);
    expect(loanInterestByYear(state, 'g').map((y) => [y.year, y.interestPaidCents])).toEqual([[2025, 300]]);
    expect(loanByPurchase(state)).toEqual(new Map([['A', 'h']]));
  });
});

describe('loan edits and closed years', () => {
  const base = (): Entry[] => [wallet('ex'), buy('A', 'ex', '2024-01-10', '0.1', '10000'), loan('h', '2024-01-01', 65_000)];

  test('loan records and coin records cannot replace each other; same-kind edits and deletes work', () => {
    const state = replay([
      ...base(),
      { ...link('K', 'h', 'A'), id: 'K' },
      { ...link('K2', 'h', 'A'), replaces: 'A', reason: 'oops' },
      { ...buy('B', 'ex', '2024-01-10', '1', '1'), replaces: 'K', reason: 'oops' },
      { ...payment('Y', 'h', '2024-02-01', '1'), replaces: 'K', reason: 'oops' },
      payment('P', 'h', '2024-02-01', '1'),
      { ...payment('P2', 'h', '2024-02-01', '2'), replaces: 'P', reason: 'typo' },
    ]);
    expect(codes(state)).toEqual({ K2: 'cannot-replace', B: 'cannot-replace', Y: 'cannot-replace' });
    expect(state.loans[0]?.payments.map((p) => p.interestCents)).toEqual([200]);
    expect(state.lots.map((l) => l.id)).toEqual(['A']);
  });

  test("a loan's id is fixed; a loan with records cannot be deleted; unlinking is deleting the link", () => {
    const del = (id: string, target: string): Entry => ({ id, kind: 'delete', at: noon('2025-01-01'), tz: TZ, replaces: target, reason: 'remove' });
    const state = replay([
      ...base(),
      link('K', 'h', 'A'),
      payment('Y', 'h', '2024-02-01', '1'),
      { ...loan('other', '2024-01-01', 1), id: 'E1', replaces: 'loan-h', reason: 'x' },
      del('D1', 'loan-h'),
      del('D2', 'K'),
      loan('z', '2024-01-01', 1, { id: 'loan-z', name: 'Unused' }),
      del('D3', 'loan-z'),
    ]);
    expect(codes(state)).toEqual({ E1: 'cannot-replace', D1: 'cannot-replace' });
    expect(state.loans.map((l) => [l.id, l.draws.length, l.payments.length])).toEqual([['h', 0, 1]]);
    // Once every record naming it is deleted, the loan can be deleted too.
    const emptied = replay([loan('h', '2025-01-01', 65_000), payment('Y', 'h', '2025-02-01', '1'), del('Ydel', 'Y'), del('Zdel', 'loan-h')]);
    expect(codes(emptied)).toEqual({});
    expect(emptied.loans).toEqual([]);
    const renamed = replay([...base(), { ...loan('h', '2024-01-01', 70_000, { name: 'Renamed' }), id: 'E2', replaces: 'loan-h', reason: 'x' }]);
    expect(renamed.loans[0]).toMatchObject({ name: 'Renamed', rates: [{ aprMillionths: 70_000 }] });
  });

  test('closed years do not lock loan records (tracking only); edits stay versioned', () => {
    const close: Entry = { id: 'zz-close', kind: 'close-year', at: noon('2025-04-01'), tz: TZ, year: 2024 };
    const state = replay([...base(), close, { ...link('zz-K', 'h', 'A'), at: noon('2024-06-01') }, { ...payment('zz-Y', 'h', '2024-06-01', '1') }]);
    expect(codes(state)).toEqual({});
    expect(state.loans[0]?.draws).toHaveLength(1);
  });
});

describe('validation of loan records', () => {
  const ok = (v: object): boolean => parseEntry({ id: 'x', at: '2025-01-01T00:00:00Z', tz: TZ, ...v }).ok;

  test('fields and ranges', () => {
    expect(ok({ kind: 'loan', loan: 'h', name: 'HELOC', opened: '2025-01-01', aprMillionths: 65_000, dayCount: 'actual/360', creditLimitCents: 1, statementDay: 31 })).toBe(true);
    expect(ok({ kind: 'loan', loan: 'h', name: 'HELOC', opened: '2025-01-01', aprMillionths: 1_000_001 })).toBe(false);
    expect(ok({ kind: 'loan', loan: 'h', name: 'HELOC', opened: '2025-01-01', aprMillionths: 6.5 })).toBe(false);
    expect(ok({ kind: 'loan', loan: 'h', name: 'HELOC', opened: '2025-01-01', aprMillionths: 1, dayCount: 'actual/366' })).toBe(false);
    expect(ok({ kind: 'loan', loan: 'h', name: 'HELOC', opened: '2025-01-01', aprMillionths: 1, statementDay: 32 })).toBe(false);
    expect(ok({ kind: 'loan', loan: 'a:b', name: 'HELOC', opened: '2025-01-01', aprMillionths: 1 })).toBe(false);
    expect(ok({ kind: 'loan-update', loan: 'h', rateFrom: '2025-01-01' })).toBe(false);
    expect(ok({ kind: 'loan-update', loan: 'h', rateFrom: '2025-01-01', aprMillionths: 0 })).toBe(true);
    expect(ok({ kind: 'loan-draw', loan: 'h', cents: 0 })).toBe(false);
    expect(ok({ kind: 'loan-link', loan: 'h', lot: 'M:A' })).toBe(false);
    expect(ok({ kind: 'loan-link', loan: 'h', lot: 'A', drawCents: 0, drawDate: '2025-02-30' })).toBe(false);
    expect(ok({ kind: 'loan-payment', loan: 'h', interestCents: 0, principalCents: 0 })).toBe(false);
    expect(ok({ kind: 'loan-payment', loan: 'h', interestCents: 1, principalCents: 0, interestThrough: '2025-01-31' })).toBe(true);
    expect(ok({ kind: 'loan-payment', loan: 'h', interestCents: 1, principalCents: 0, total: 1 })).toBe(false);
    expect(ok({ kind: 'loan-statement', loan: 'h', balanceCents: 0 })).toBe(true);
  });
});

describe('units and helpers', () => {
  test('APR text ↔ millionths', () => {
    expect(parseAprPercent('6.5')).toBe(65_000);
    expect(parseAprPercent(' 7.875 % ')).toBe(78_750);
    expect(parseAprPercent('100')).toBe(1_000_000);
    expect(parseAprPercent('100.01')).toBeNull();
    expect(parseAprPercent('6.12345')).toBeNull();
    expect(parseAprPercent('abc')).toBeNull();
    expect(formatAprPercent(65_000)).toBe('6.50%');
    expect(formatAprPercent(78_750)).toBe('7.875%');
    expect(formatAprPercent(62_525)).toBe('6.2525%');
    expect(formatAprPercent(0)).toBe('0.00%');
  });

  test('largest-remainder split adds back exactly and never goes negative', () => {
    expect(splitByWeights(1, [1n, 1n, 0n])).toEqual([1, 0, 0]);
    expect(splitByWeights(2, [1n, 1n, 1n])).toEqual([1, 1, 0]);
    expect(splitByWeights(10, [3n, 7n])).toEqual([3, 7]);
    expect(splitByWeights(5, [1n, 2n])).toEqual([2, 3]);
  });

  test('day numbers and statement closing dates', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dateOfDay(dayNumber('2024-02-29') + 1)).toBe('2024-03-01');
    expect(latestMonthDay('2025-03-20', 31)).toBe('2025-02-28');
    expect(latestMonthDay('2025-03-31', 31)).toBe('2025-03-31');
    expect(latestMonthDay('2025-01-04', 5)).toBe('2024-12-05');
    expect(latestMonthDay('2024-03-05', 30)).toBe('2024-02-29');
  });
});

describe('opening-lots CSV: funded_by', () => {
  const HEADER = 'wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin,tz,funded_by';
  const ids = (): (() => string) => {
    let n = 0;
    return () => `id-${String(++n).padStart(3, '0')}`;
  };
  const book = replay([wallet('ex', 'exchange', 'Exchange'), loan('h', '2020-01-01', 65_000), loan('old', '2019-01-01', 1, { id: 'loan-old', name: 'Old line' }), { id: 'U', kind: 'loan-update', at: noon('2019-06-01'), tz: TZ, loan: 'old', closed: true }, loan('dup', '2020-01-01', 1, { id: 'loan-dup', name: 'Old line' })]);

  test('a file with only loan names: matched by name, an open loan before a closed one with the same name', () => {
    expect(book.errors).toEqual([]);
    const text = [HEADER, 'Exchange,2021-03-15 19:00:00,0.5,50000000,28000,,Documented,Statement,,heloc', 'Exchange,2021-03-16 19:00:00,0.1,10000000,5000,,Documented,Statement,,', 'Exchange,2021-03-17 19:00:00,0.1,10000000,5000,,Documented,Statement,,Old line'].join('\n');
    const pending = [...book.loans, { id: 'new', name: 'Pending', closed: false }];
    const r = importOpeningLotsCsv(text, { wallets: book.wallets, tz: TZ, newId: ids(), loans: pending });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.links).toEqual([{ id: 'id-004', kind: 'loan-link', at: '2021-03-15T19:00:00Z', tz: TZ, loan: 'h', lot: 'id-001' }, { id: 'id-005', kind: 'loan-link', at: '2021-03-17T19:00:00Z', tz: TZ, loan: 'dup', lot: 'id-003' }]);
    const state = replay([wallet('ex', 'exchange', 'Exchange'), loan('h', '2020-01-01', 65_000), ...r.value.entries, ...r.value.links.filter((l) => l.loan === 'h')]);
    expect(loanSummary(state, 'h', PRICE, '2021-03-20')).toMatchObject({ drawnCents: 2_800_000, heldSats: 50_000_000 });
    const out = exportOpeningLotsCsv(state).csv.split(/\r?\n/);
    expect(out[0]).toBe(`${HEADER},funded_by_id,funded_draw_usd,funded_draw_date,origin_id`);
    expect(out[1]?.endsWith(',America/Boise,HELOC,h,28000.00,2021-03-15,id-001')).toBe(true);
    expect(out[2]?.endsWith(',America/Boise,,,,,')).toBe(true);
    expect(exportOpeningLotsCsv(replay([wallet('ex', 'exchange', 'Exchange'), ...r.value.entries])).csv.split(/\r?\n/)[0]).toBe(HEADER.replace(',funded_by', ''));
  });

  test('an unknown or ambiguous loan name is a row error; without loans every name is unknown', () => {
    const twin = [{ id: 'a', name: 'Twin', closed: false }, { id: 'b', name: 'twin', closed: false }];
    const text = [HEADER, 'Exchange,2021-03-15 19:00:00,,1,1,,Documented,,,Nope', 'Exchange,2021-03-15 19:00:00,,1,1,,Documented,,,TWIN'].join('\n');
    const r = importOpeningLotsCsv(text, { wallets: book.wallets, tz: TZ, newId: ids(), loans: twin });
    expect(r.ok ? [] : r.error).toEqual([{ row: 2, message: 'no loan named "Nope" (add the loan first)' }, { row: 3, message: 'more than one loan is named "TWIN"' }]);
    const r2 = importOpeningLotsCsv(text, { wallets: book.wallets, tz: TZ, newId: ids() });
    expect(r2.ok ? [] : r2.error.length).toBe(2);
    const bad = [`${HEADER},funded_draw_usd,funded_draw_date`, 'Exchange,2021-03-15 19:00:00,,1,1,,Documented,,,HELOC,abc,2021-02-30'].join('\n');
    const r3 = importOpeningLotsCsv(bad, { wallets: book.wallets, tz: TZ, newId: ids(), loans: book.loans });
    expect(r3.ok ? [] : r3.error.map((p) => p.message)).toEqual(['funded_draw_usd "abc" is not a dollar amount', 'funded_draw_date "2021-02-30" is not a date like 2025-01-31']);
  });

  test('Example L round trip: one link per purchase with its whole draw, so drawn, owed, interest and statements match', () => {
    const state = replay([...exampleCoins(), ...exampleLoan()]);
    const before = loanSummary(state, 'h', PRICE, AS_OF);
    const exported = exportOpeningLotsCsv(state);
    expect(exported.warnings).toEqual([]);
    const r = importOpeningLotsCsv(exported.csv, { wallets: state.wallets, tz: TZ, newId: ids(), loans: state.loans });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.links.map((l) => [l.drawCents, l.drawDate, l.alsoLots?.length ?? 0]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      [500_000, '2025-01-06', 0],
      [500_000, '2025-01-21', 0],
      [500_000, '2025-02-10', 0],
      [500_000, '2025-03-03', 0],
    ]);
    const after = replay([wallet('ex'), wallet('cold', 'self-custody'), ...r.value.entries, ...r.value.links, ...exampleLoan().filter((e) => e.kind !== 'loan-link')]);
    expect(after.errors).toEqual([]);
    const s = loanSummary(after, 'h', PRICE, AS_OF);
    const pick = (x: typeof s): unknown => x === null ? null : { a: x.purchaseCount, b: x.drawnCents, c: x.principalOwedCents, d: x.owedNowCents, e: x.interestPaidCents, f: x.accruedInterestCents, g: x.statements.map((t) => t.differenceCents), h: x.heldSats, i: x.heldCostCents, j: x.valueCents, k: x.breakEvenPriceCents, l: x.payoffLeftoverSats };
    expect(pick(s)).toEqual(pick(before));
    expect(loanPurchases(after, 'h', PRICE, AS_OF).map((p) => p.interestShareCents)).toEqual([15_512, 14_175, 12_393, 10_523]);
  });

  test('a purchase split across rows re-imports as one link; a purchase with no coins left is a warning', () => {
    const state = replay([
      wallet('ex', 'exchange', 'Exchange'),
      wallet('cold', 'self-custody', 'Cold'),
      buy('A', 'ex', '2024-01-10', '0.3', '1000'),
      buy('B', 'ex', '2024-01-11', '0.1', '500'),
      move('M', 'ex', 'cold', '2024-02-01', sats('0.1'), 0, '0', [pick('A', '0.1')]),
      sell('S', 'ex', '2024-03-01', [pick('B', '0.1')], '600'),
      loan('h', '2024-01-01', 65_000),
      link('K1', 'h', 'A', { drawCents: cents('1000.01') }),
      link('K2', 'h', 'B'),
    ]);
    const exported = exportOpeningLotsCsv(state);
    expect(exported.warnings).toEqual(['Purchase B was paid with HELOC, but none of its coins are left, so the CSV cannot carry its $500.00 draw. Use the entries JSON.']);
    const r = importOpeningLotsCsv(exported.csv, { wallets: state.wallets, tz: TZ, newId: ids(), loans: state.loans });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.links).toHaveLength(1);
    expect(r.value.links[0]).toMatchObject({ drawCents: cents('1000.01'), drawDate: '2024-01-10', alsoLots: [expect.any(String)] });
    const after = replay([wallet('ex', 'exchange', 'Exchange'), wallet('cold', 'self-custody', 'Cold'), loan('h', '2024-01-01', 65_000), ...r.value.entries, ...r.value.links]);
    expect(loanSummary(after, 'h', PRICE, '2024-12-31')).toMatchObject({ purchaseCount: 1, drawnCents: cents('1000.01'), heldSats: sats('0.3') });
    expect(loanByPurchase(after).size).toBe(2);
  });

  test('without draw columns, a purchase split across rows draws the cost of its lots from the earliest date', () => {
    const text = [`${HEADER},origin_id`, 'Exchange,2021-03-16 19:00:00,,1,2,,Documented,,,HELOC,P', 'Exchange,2021-03-15 19:00:00,,1,3,,Documented,,,HELOC,P'].join('\n');
    const r = importOpeningLotsCsv(text, { wallets: book.wallets, tz: TZ, newId: ids(), loans: book.loans });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.links).toEqual([{ id: 'id-003', kind: 'loan-link', at: '2021-03-16T19:00:00Z', tz: TZ, loan: 'h', lot: 'id-001', alsoLots: ['id-002'] }]);
    const after = replay([wallet('ex', 'exchange', 'Exchange'), loan('h', '2020-01-01', 65_000), ...r.value.entries, ...r.value.links]);
    expect(after.loans[0]?.draws).toEqual([{ entryId: 'id-003', date: '2021-03-15', cents: 500, lotId: 'id-001', lotIds: ['id-001', 'id-002'] }]);
  });

  test('coins that cost $0 share their draw by sats', () => {
    const state = replay([wallet('ex', 'exchange', 'Exchange'), wallet('cold', 'self-custody', 'Cold'), buy('A', 'ex', '2024-01-10', '0.3', '0'), move('M', 'ex', 'cold', '2024-02-01', sats('0.1'), 0, '0', [pick('A', '0.1')]), loan('h', '2024-01-01', 65_000), link('K', 'h', 'A', { drawCents: cents('3') })]);
    const rows = exportOpeningLotsCsv(state).csv.split(/\r?\n/).slice(1, 3);
    expect(rows.map((r) => r.split(',')[11]).sort()).toEqual(['1.00', '2.00']);
  });

  test('a lot paid by a closed loan goes back to that loan, not to an open loan that now has its name', () => {
    const entries: Entry[] = [
      wallet('ex', 'exchange', 'Exchange'),
      buy('B', 'ex', '2024-02-01', '0.1', '5000'),
      loan('old', '2024-01-01', 65_000, { id: 'loan-old' }),
      link('K', 'old', 'B'),
      { id: 'close-old', kind: 'loan-update', at: noon('2024-06-01'), tz: TZ, loan: 'old', closed: true },
      loan('new', '2024-01-01', 70_000, { id: 'loan-new', name: 'Second' }),
      { id: 'rename-new', kind: 'loan-update', at: noon('2024-07-01'), tz: TZ, loan: 'new', name: 'HELOC' },
    ];
    const state = replay(entries);
    expect(state.errors).toEqual([]);
    const r = importOpeningLotsCsv(exportOpeningLotsCsv(state).csv, { wallets: state.wallets, tz: TZ, newId: ids(), loans: state.loans });
    expect(r.ok ? r.value.links.map((l) => l.loan) : r.error).toEqual(['old']);
  });
});
