/** Loan property tests (docs/loans-spec.md "Properties"): random synthetic histories, fast-check. */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { dateOfDay, dayNumber } from '../src/dates.ts';
import { estimateLoanInterest, loanInterestByYear, loanPurchases, loanSummary } from '../src/loans.ts';
import { oldestFirst } from '../src/picks.ts';
import { holdings, yearSummary } from '../src/reports.ts';
import { replay } from '../src/replay.ts';
import type { Entry, LedgerState } from '../src/types.ts';
import { TZ, wallet } from './helpers.ts';

const RUNS = { numRuns: 300 };
const DAY0 = dayNumber('2024-01-01');
const date = (d: number): string => dateOfDay(DAY0 + d);
const at = (d: number, n: number): string => `${date(d)}T${String(10 + (n % 10)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00Z`;

interface Coin {
  day: number;
  sats: number;
  cents: number;
}
interface Out {
  kind: 'sell' | 'move' | 'give' | 'lost';
  day: number;
  sats: number;
  money: number;
}

const coinArb = fc.record({ day: fc.integer({ min: 0, max: 500 }), sats: fc.integer({ min: 1, max: 50_000_000 }), cents: fc.integer({ min: 1, max: 5_000_000 }) });
const outArb = fc.record({ kind: fc.constantFrom<Out['kind']>('sell', 'move', 'give', 'lost'), day: fc.integer({ min: 0, max: 700 }), sats: fc.integer({ min: 1, max: 60_000_000 }), money: fc.integer({ min: 0, max: 5_000_000 }) });

/** Buys plus disposals picked oldest first from what each wallet holds at the time. */
function coinHistory(coins: readonly Coin[], outs: readonly Out[]): Entry[] {
  const entries: Entry[] = [wallet('ex'), wallet('cold', 'self-custody')];
  coins.forEach((c, i) => entries.push({ id: `B${i}`, kind: 'buy', at: at(c.day, i), tz: TZ, wallet: 'ex', sats: c.sats, costCents: c.cents, tier: 'documented' }));
  [...outs].sort((a, b) => a.day - b.day).forEach((o, i) => {
    const state = replay(entries.filter((e) => e.kind === 'wallet' || e.at <= at(o.day, 59)));
    const w = o.kind === 'move' || i % 2 === 0 ? 'ex' : 'cold';
    const held = state.lots.filter((l) => l.wallet === w).reduce((s, l) => s + l.sats, 0);
    const sats = Math.min(o.sats, held);
    if (sats === 0) return;
    const r = oldestFirst(state.lots, w, sats);
    if (!r.ok) throw new Error('oldestFirst failed');
    const base = { id: `X${i}`, at: at(o.day, 59), tz: TZ, picks: r.value, sats };
    if (o.kind === 'sell') entries.push({ ...base, kind: 'sell', wallet: w, proceedsCents: o.money, spent: false });
    if (o.kind === 'move') entries.push({ ...base, kind: 'move', from: 'ex', to: 'cold', feeSats: 0, feeValueCents: 0 });
    if (o.kind === 'give') entries.push({ ...base, kind: 'give', wallet: w, valueCents: o.money, to: 'person', recipient: 'R' });
    if (o.kind === 'lost') entries.push({ ...base, kind: 'lost', wallet: w, cause: 'hack' });
  });
  return entries;
}

interface LoanOps {
  links: boolean[];
  draws: { day: number; cents: number }[];
  payments: { day: number; interest: number; principal: number; through: number | null }[];
  rates: { day: number; apr: number }[];
  apr: number;
}
const loanOpsArb: fc.Arbitrary<LoanOps> = fc.record({
  links: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
  draws: fc.array(fc.record({ day: fc.integer({ min: 0, max: 600 }), cents: fc.integer({ min: 1, max: 3_000_000 }) }), { maxLength: 3 }),
  payments: fc.array(fc.record({ day: fc.integer({ min: 0, max: 700 }), interest: fc.integer({ min: 0, max: 50_000 }), principal: fc.integer({ min: 0, max: 4_000_000 }), through: fc.option(fc.integer({ min: -30, max: 700 }), { nil: null }) }).filter((p) => p.interest + p.principal > 0), { maxLength: 12 }),
  rates: fc.array(fc.record({ day: fc.integer({ min: -10, max: 700 }), apr: fc.integer({ min: 0, max: 200_000 }) }), { maxLength: 3 }),
  apr: fc.integer({ min: 0, max: 200_000 }),
});

function loanRecords(ops: LoanOps, coinCount: number, withDraws = true): Entry[] {
  const out: Entry[] = [{ id: 'Lh', kind: 'loan', at: at(0, 0), tz: TZ, loan: 'h', name: 'HELOC', opened: date(0), aprMillionths: ops.apr, creditLimitCents: 10_000_000, statementDay: 25 }];
  ops.links.slice(0, coinCount).forEach((on, i) => on && out.push({ id: `K${i}`, kind: 'loan-link', at: at(800, i), tz: TZ, loan: 'h', lot: `B${i}` }));
  if (withDraws) ops.draws.forEach((d, i) => out.push({ id: `D${i}`, kind: 'loan-draw', at: at(d.day, i), tz: TZ, loan: 'h', cents: d.cents }));
  ops.payments.forEach((p, i) => out.push({ id: `Y${i}`, kind: 'loan-payment', at: at(p.day, i), tz: TZ, loan: 'h', interestCents: p.interest, principalCents: p.principal, ...(p.through === null ? {} : { interestThrough: date(p.through) }) }));
  ops.rates.forEach((r, i) => out.push({ id: `R${i}`, kind: 'loan-update', at: at(Math.max(0, r.day), i), tz: TZ, loan: 'h', aprMillionths: r.apr, rateFrom: date(r.day) }));
  out.push({ id: 'T0', kind: 'loan-statement', at: at(300, 1), tz: TZ, loan: 'h', balanceCents: 1_000_000 });
  return out;
}

const historyArb = fc.record({ coins: fc.array(coinArb, { minLength: 1, maxLength: 8 }), outs: fc.array(outArb, { maxLength: 6 }), ops: loanOpsArb });

/** Everything tax and holdings depend on. */
function taxView(state: LedgerState): unknown {
  return { lots: state.lots, holdings: holdings(state), years: [2024, 2025, 2026].map((y) => yearSummary(state, y)), cpa: state.cpaFlags, closeOuts: state.closeOuts };
}

describe('loan properties', () => {
  test('adding or removing loan records never changes lots, cost basis, gains or holdings', () => {
    fc.assert(
      fc.property(historyArb, ({ coins, outs, ops }) => {
        const coinsOnly = coinHistory(coins, outs);
        const sneaky: Entry[] = [
          { id: 'Z1', kind: 'loan-link', at: at(10, 1), tz: TZ, loan: 'h', lot: 'B0', replaces: 'B0', reason: 'try to replace a buy' },
          { id: 'Z2', kind: 'delete', at: at(10, 2), tz: TZ, replaces: 'Lh', reason: 'delete the loan' },
        ];
        const withLoan = replay([...coinsOnly, ...loanRecords(ops, coins.length), ...sneaky]);
        expect(taxView(withLoan)).toEqual(taxView(replay(coinsOnly)));
      }),
      { numRuns: 150 },
    );
  });

  test('interest shares add back exactly; owed is never negative (an overpayment is a credit)', () => {
    fc.assert(
      fc.property(historyArb, fc.integer({ min: 0, max: 800 }), ({ coins, outs, ops }, asOf) => {
        const state = replay([...coinHistory(coins, outs), ...loanRecords(ops, coins.length, false)]);
        const onDate = date(asOf);
        const s = loanSummary(state, 'h', 6_000_000, onDate);
        if (s === null) throw new Error('loan missing');
        const shares = loanPurchases(state, 'h', 6_000_000, onDate).reduce((t, p) => t + p.interestShareCents, 0);
        // Every draw is a purchase here, so the shares plus anything paid before the first draw are the interest paid.
        expect(shares + s.unallocatedInterestCents).toBe(s.interestPaidCents);
        expect(s.interestOnPurchasesCents).toBe(shares);
        expect(s.principalOwedCents).toBeGreaterThanOrEqual(0);
        expect(s.creditCents).toBeGreaterThanOrEqual(0);
        expect(s.principalOwedCents === 0 || s.creditCents === 0).toBe(true);
        expect(s.principalOwedCents - s.creditCents).toBe(s.drawnCents - s.principalRepaidCents);
        expect(s.accruedInterestCents).toBeGreaterThanOrEqual(0);
        expect(s.owedNowCents).toBe(s.principalOwedCents + s.accruedInterestCents);
      }),
      RUNS,
    );
  });

  test('with draws that were not purchases, the purchases get at most the interest paid; yearly totals add up', () => {
    fc.assert(
      fc.property(historyArb, ({ coins, outs, ops }) => {
        const state = replay([...coinHistory(coins, outs), ...loanRecords(ops, coins.length)]);
        const s = loanSummary(state, 'h', 6_000_000, '2026-12-31') as NonNullable<ReturnType<typeof loanSummary>>;
        expect(s.interestOnPurchasesCents).toBeLessThanOrEqual(s.interestPaidCents);
        const years = loanInterestByYear(state);
        expect(years.reduce((t, y) => t + y.interestPaidCents, 0)).toBe(s.interestPaidCents);
        expect(years.reduce((t, y) => t + y.onPurchasesCents, 0)).toBe(s.interestOnPurchasesCents);
      }),
      RUNS,
    );
  });

  test('linking order (and the link records’ ids and times) does not matter', () => {
    fc.assert(
      fc.property(historyArb, fc.integer({ min: 0, max: 1_000 }), ({ coins, outs, ops }, seed) => {
        const coinsOnly = coinHistory(coins, outs);
        const records = loanRecords(ops, coins.length);
        const links = records.filter((e) => e.kind === 'loan-link');
        const others = records.filter((e) => e.kind !== 'loan-link');
        // Rotate which link gets which id and time.
        const shuffled = links.map((l, i) => {
          const j = (i + seed) % links.length;
          return { ...l, id: (links[j] as Entry).id, at: (links[(j + 1) % links.length] as Entry).at };
        });
        const a = replay([...coinsOnly, ...others, ...links]);
        const b = replay([...coinsOnly, ...others, ...shuffled.reverse()]);
        const view = (st: LedgerState): unknown => ({ s: loanSummary(st, 'h', 7_000_000, '2026-06-30'), p: loanPurchases(st, 'h', 7_000_000, '2026-06-30').map((p) => ({ ...p, linkEntryId: '' })) });
        expect(view(b)).toEqual(view(a));
      }),
      RUNS,
    );
  });

  test('payoff leftover never falls as the price rises', () => {
    fc.assert(
      fc.property(historyArb, fc.integer({ min: 1, max: 50_000_000 }), fc.integer({ min: 1, max: 50_000_000 }), ({ coins, outs, ops }, p1, p2) => {
        const state = replay([...coinHistory(coins, outs), ...loanRecords(ops, coins.length)]);
        const [lo, hi] = p1 <= p2 ? [p1, p2] : [p2, p1];
        const a = loanSummary(state, 'h', lo, '2026-01-01') as NonNullable<ReturnType<typeof loanSummary>>;
        const b = loanSummary(state, 'h', hi, '2026-01-01') as NonNullable<ReturnType<typeof loanSummary>>;
        expect(a.payoffLeftoverSats as number).toBeLessThanOrEqual(b.payoffLeftoverSats as number);
        expect(a.payoffLeftoverPrincipalOnlySats as number).toBeLessThanOrEqual(b.payoffLeftoverPrincipalOnlySats as number);
        expect(a.payoffLeftoverSats as number).toBeLessThanOrEqual(a.payoffLeftoverPrincipalOnlySats as number);
      }),
      RUNS,
    );
  });

  test('interest over two adjoining periods is the whole period’s interest within a cent (rounded once per period)', () => {
    fc.assert(
      fc.property(historyArb, fc.integer({ min: 0, max: 600 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), ({ coins, outs, ops }, from, n1, n2) => {
        const state = replay([...coinHistory(coins, outs), ...loanRecords(ops, coins.length)]);
        const whole = estimateLoanInterest(state, 'h', date(from), date(from + n1 + n2 + 1));
        const parts = estimateLoanInterest(state, 'h', date(from), date(from + n1)) + estimateLoanInterest(state, 'h', date(from + n1 + 1), date(from + n1 + n2 + 1));
        expect(Math.abs(whole - parts)).toBeLessThanOrEqual(1);
      }),
      RUNS,
    );
  });
});
