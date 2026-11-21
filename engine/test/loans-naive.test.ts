/**
 * The engine's interest figures against a plain day-by-day BigInt loop written from docs/loans-spec.md "Formulas"
 * only (random synthetic histories).
 */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { dateOfDay, dayNumber } from '../src/dates.ts';
import { estimateLoanInterest, loanInterestByYear, loanPurchases, loanSummary, suggestLoanPayment } from '../src/loans.ts';
import { replay } from '../src/replay.ts';
import type { Entry, Loan } from '../src/types.ts';
import { TZ, wallet } from './helpers.ts';

const DAY0 = dayNumber('2023-12-20'); // spans the 2024 leap day
const date = (d: number): string => dateOfDay(DAY0 + d);
// Local noon in Boise is 19:00Z (MST) or 18:00Z (MDT): use 17:00Z so the local date is always `date(d)`.
const at = (d: number, n: number): string => `${date(d)}T17:${String(n % 60).padStart(2, '0')}:00Z`;

interface Ops {
  apr: number;
  basis360: boolean;
  statementDay: number | null;
  buys: { day: number; cents: number; link: boolean }[];
  draws: { day: number; cents: number }[];
  payments: { day: number; interest: number; principal: number; through: number | null }[];
  rates: { day: number; apr: number }[];
}
const opsArb: fc.Arbitrary<Ops> = fc.record({
  apr: fc.integer({ min: 0, max: 250_000 }),
  basis360: fc.boolean(),
  statementDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
  buys: fc.array(fc.record({ day: fc.integer({ min: -20, max: 900 }), cents: fc.integer({ min: 0, max: 9_000_000 }), link: fc.boolean() }), { minLength: 1, maxLength: 10 }),
  draws: fc.array(fc.record({ day: fc.integer({ min: -20, max: 900 }), cents: fc.integer({ min: 1, max: 9_000_000 }) }), { maxLength: 6 }),
  payments: fc.array(
    fc.record({ day: fc.integer({ min: -20, max: 950 }), interest: fc.integer({ min: 0, max: 90_000 }), principal: fc.integer({ min: 0, max: 20_000_000 }), through: fc.option(fc.integer({ min: -40, max: 960 }), { nil: null }) }).filter((p) => p.interest + p.principal > 0),
    { maxLength: 20 },
  ),
  rates: fc.array(fc.record({ day: fc.integer({ min: -30, max: 900 }), apr: fc.integer({ min: 0, max: 250_000 }) }), { maxLength: 6 }),
});

function entries(o: Ops): Entry[] {
  const out: Entry[] = [wallet('ex')];
  o.buys.forEach((b, i) => out.push({ id: `B${i}`, kind: 'buy', at: at(b.day, i), tz: TZ, wallet: 'ex', sats: 1_000_000 + i, costCents: b.cents, tier: 'documented' }));
  out.push({ id: 'Lh', kind: 'loan', at: at(0, 0), tz: TZ, loan: 'h', name: 'HELOC', opened: date(0), aprMillionths: o.apr, dayCount: o.basis360 ? 'actual/360' : 'actual/365', ...(o.statementDay === null ? {} : { statementDay: o.statementDay }) });
  o.buys.forEach((b, i) => b.link && out.push({ id: `K${i}`, kind: 'loan-link', at: at(1000, i), tz: TZ, loan: 'h', lot: `B${i}` }));
  o.draws.forEach((d, i) => out.push({ id: `D${i}`, kind: 'loan-draw', at: at(d.day, i), tz: TZ, loan: 'h', cents: d.cents }));
  o.payments.forEach((p, i) => out.push({ id: `Y${String(i).padStart(2, '0')}`, kind: 'loan-payment', at: at(p.day, i), tz: TZ, loan: 'h', interestCents: p.interest, principalCents: p.principal, ...(p.through === null ? {} : { interestThrough: date(p.through) }) }));
  // Rate records dated the day they take effect (later `at` wins on the same day).
  o.rates.forEach((r, i) => out.push({ id: `R${i}`, kind: 'loan-update', at: at(Math.max(r.day, 0), 30 + i), tz: TZ, loan: 'h', aprMillionths: r.apr, rateFrom: date(r.day) }));
  return out;
}

/** Spec formula, day by day: Σ max(0, P(d)) × r(d) ÷ (10^6 × B), rounded once half-up. */
function naiveInterest(loan: Loan, fromDay: number, throughDay: number, asOf: string): number {
  const draws = loan.draws.filter((d) => d.date <= asOf);
  const pays = loan.payments.filter((p) => p.date <= asOf);
  const rates = [...loan.rates].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  let w = 0n;
  for (let d = fromDay; d <= throughDay; d++) {
    const ds = dateOfDay(d);
    const P = draws.filter((x) => x.date <= ds).reduce((s, x) => s + BigInt(x.cents), 0n) - pays.filter((p) => p.date <= ds).reduce((s, p) => s + BigInt(p.principalCents), 0n);
    const r = [...rates].reverse().find((x) => x.from <= ds) ?? rates[0];
    if (P > 0n) w += P * BigInt((r as { aprMillionths: number }).aprMillionths);
  }
  const den = 1_000_000n * (loan.dayCount === 'actual/360' ? 360n : 365n);
  return Number((w * 2n + den) / (2n * den));
}

describe('loan interest against a day-by-day loop', () => {
  test('estimateLoanInterest = spec formula for any window (leap day, 360, overpay, payments before draws, many rates)', () => {
    fc.assert(
      fc.property(opsArb, fc.integer({ min: -30, max: 950 }), fc.integer({ min: 0, max: 400 }), (o, from, len) => {
        const state = replay(entries(o));
        const loan = state.loans[0] as Loan;
        const through = from + len;
        expect(estimateLoanInterest(state, 'h', date(from), date(through))).toBe(naiveInterest(loan, DAY0 + from, DAY0 + through, date(through)));
      }),
      { numRuns: 400 },
    );
  });

  test('summary: owed, accrued, credit, shares add back, never negative, by-year agrees', () => {
    fc.assert(
      fc.property(opsArb, fc.integer({ min: 0, max: 1000 }), (o, asOfDay) => {
        const state = replay(entries(o));
        expect(state.errors).toEqual([]);
        const loan = state.loans[0] as Loan;
        const asOf = date(asOfDay);
        const s = loanSummary(state, 'h', 9_000_000, asOf);
        if (s === null) throw new Error('no summary');
        const drawn = loan.draws.filter((d) => d.date <= asOf).reduce((t, d) => t + d.cents, 0);
        const repaid = loan.payments.filter((p) => p.date <= asOf).reduce((t, p) => t + p.principalCents, 0);
        expect(s.principalOwedCents).toBe(Math.max(0, drawn - repaid));
        expect(s.creditCents).toBe(Math.max(0, repaid - drawn));
        // Accrued: days after the latest interestThrough (of payments with interest) through as-of.
        const throughs = loan.payments.filter((p) => p.date <= asOf && p.interestCents > 0).map((p) => dayNumber(p.interestThrough));
        const firstDraw = Math.min(dayNumber(loan.opened), ...loan.draws.filter((d) => d.date <= asOf).map((d) => dayNumber(d.date)));
        const fromDay = throughs.length === 0 ? firstDraw : Math.max(...throughs) + 1;
        const accrued = fromDay > dayNumber(asOf) ? 0 : naiveInterest(loan, fromDay, dayNumber(asOf), asOf);
        expect(s.accruedInterestCents).toBe(accrued);
        expect(s.owedNowCents).toBe(s.principalOwedCents + accrued);
        const ps = loanPurchases(state, 'h', 9_000_000, asOf);
        for (const p of ps) expect(p.interestShareCents).toBeGreaterThanOrEqual(0);
        expect(s.interestOnPurchasesCents).toBeLessThanOrEqual(s.interestPaidCents - s.unallocatedInterestCents);
        if (s.otherDrawsCents === 0) expect(s.interestOnPurchasesCents + s.unallocatedInterestCents).toBe(s.interestPaidCents);
        if (s.payoffLeftoverSats !== null) expect(s.payoffLeftoverSats).toBeLessThanOrEqual(s.payoffLeftoverPrincipalOnlySats as number);
      }),
      { numRuns: 400 },
    );
  });

  test('interest by year (as of the last record) matches the summary as of a date after every record', () => {
    fc.assert(
      fc.property(opsArb, (o) => {
        const state = replay(entries(o));
        const far = date(2000);
        const s = loanSummary(state, 'h', null, far);
        const years = loanInterestByYear(state, 'h');
        expect(years.reduce((t, y) => t + y.interestPaidCents, 0)).toBe(s?.interestPaidCents);
        expect(years.reduce((t, y) => t + y.onPurchasesCents, 0)).toBe(s?.interestOnPurchasesCents);
      }),
      { numRuns: 300 },
    );
  });

  test('the payment pre-fill is the spec formula over its own window, less interest already paid for that cycle', () => {
    fc.assert(
      fc.property(opsArb, fc.integer({ min: 0, max: 950 }), (o, payDay) => {
        const state = replay(entries(o));
        const loan = state.loans[0] as Loan;
        const sug = suggestLoanPayment(state, 'h', date(payDay));
        if (sug === null) throw new Error('no suggestion');
        expect(sug.fromDate <= sug.throughDate || sug.days === 0).toBe(true);
        const paid = loan.payments.filter((p) => p.interestCents > 0 && p.interestThrough === sug.throughDate).reduce((t, p) => t + p.interestCents, 0);
        expect(sug.alreadyPaidCents).toBe(paid);
        const cycle = sug.fromDate > sug.throughDate ? 0 : naiveInterest(loan, dayNumber(sug.fromDate), dayNumber(sug.throughDate), sug.throughDate);
        expect(sug.interestCents).toBe(Math.max(0, cycle - paid));
      }),
      { numRuns: 300 },
    );
  });
});
