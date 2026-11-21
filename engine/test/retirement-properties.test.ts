/** Retirement purchases never reach tax output: random synthetic histories, fast-check. */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { dateOfDay, dayNumber } from '../src/dates.ts';
import { form8949Csv } from '../src/io.ts';
import { oldestFirst } from '../src/picks.ts';
import { taxContext, taxInput } from '../src/planner/context.ts';
import { planSale } from '../src/planner/sale.ts';
import { holdings, yearSummary } from '../src/reports.ts';
import { replay } from '../src/replay.ts';
import { allBitcoin } from '../src/retirement.ts';
import { taxForYear } from '../src/tax/tax.ts';
import type { Entry, LedgerState } from '../src/types.ts';
import { TZ, wallet } from './helpers.ts';

const DAY0 = dayNumber('2024-01-01');
const at = (d: number, n: number): string => `${dateOfDay(DAY0 + d)}T${String(10 + (n % 10)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00Z`;
const YEARS = [2024, 2025, 2026];

const coinArb = fc.record({ day: fc.integer({ min: 0, max: 700 }), sats: fc.integer({ min: 1, max: 50_000_000 }), cents: fc.integer({ min: 0, max: 5_000_000 }) });
const sellArb = fc.record({ day: fc.integer({ min: 0, max: 900 }), sats: fc.integer({ min: 1, max: 60_000_000 }), cents: fc.integer({ min: 0, max: 9_000_000 }) });
const retArb = fc.record({ day: fc.integer({ min: 0, max: 900 }), sats: fc.integer({ min: 1, max: 80_000_000 }), cents: fc.integer({ min: 0, max: 9_000_000 }), wallet: fc.constantFrom('ira', 'ira', 'ex', 'nope'), edit: fc.constantFrom<'none' | 'edit' | 'delete' | 'into-buy' | 'from-buy'>('none', 'none', 'edit', 'delete', 'into-buy', 'from-buy') });

/** Buys and oldest-first sales on one exchange wallet, plus an empty retirement wallet. */
function coinHistory(coins: readonly { day: number; sats: number; cents: number }[], sells: readonly { day: number; sats: number; cents: number }[]): Entry[] {
  const entries: Entry[] = [wallet('ex'), wallet('ira', 'retirement'), { id: 'set', kind: 'settings', at: at(0, 0), tz: TZ, patch: { filingStatus: 'married-joint', wagesCents: 13_000_000 } }];
  coins.forEach((c, i) => entries.push({ id: `B${i}`, kind: 'buy', at: at(c.day, i), tz: TZ, wallet: 'ex', sats: c.sats, costCents: c.cents, tier: 'documented' }));
  [...sells].sort((a, b) => a.day - b.day).forEach((s, i) => {
    const state = replay(entries.filter((e) => e.kind === 'wallet' || e.at <= at(s.day, 59)));
    const held = state.lots.reduce((n, l) => n + l.sats, 0);
    const sats = Math.min(s.sats, held);
    if (sats === 0) return;
    const r = oldestFirst(state.lots, 'ex', sats);
    if (!r.ok) throw new Error('oldestFirst failed');
    entries.push({ id: `S${i}`, kind: 'sell', at: at(s.day, 59), tz: TZ, wallet: 'ex', sats, proceedsCents: s.cents, picks: r.value, spent: false });
  });
  return entries;
}

/** Retirement purchases, some edited or deleted, some aimed at the wrong wallet, some trying to replace a taxable buy. */
function retirementRecords(rets: readonly (typeof retArb extends fc.Arbitrary<infer T> ? T : never)[], coinCount: number): Entry[] {
  const out: Entry[] = [];
  rets.forEach((r, i) => {
    const e: Entry = { id: `Q${i}`, kind: 'retirement-buy', at: at(r.day, i), tz: TZ, wallet: r.wallet, sats: r.sats, costCents: r.cents };
    if (r.edit === 'into-buy') {
      out.push({ ...e, replaces: `B${i % coinCount}`, reason: 'try to turn a taxable buy into a retirement one' });
      return;
    }
    out.push(e);
    const later = { at: at(Math.min(900, r.day + 3), i), tz: TZ };
    if (r.edit === 'edit') out.push({ ...e, ...later, id: `QE${i}`, sats: r.sats + 1, replaces: e.id, reason: 'typo' });
    if (r.edit === 'delete') out.push({ ...later, id: `QD${i}`, kind: 'delete', replaces: e.id, reason: 'not mine' });
    if (r.edit === 'from-buy') out.push({ ...later, id: `QB${i}`, kind: 'buy', wallet: 'ex', sats: r.sats, costCents: r.cents, tier: 'documented', replaces: e.id, reason: 'try to make it taxable' });
  });
  return out;
}

/** Every tax output: lots, gains, Form 8949, tax estimates, a sale plan, taxable holdings and the problems with coin entries. */
function taxView(state: LedgerState): unknown {
  const taxable = { ...holdings(state), retirement: [] };
  return {
    lots: state.lots,
    disposals: state.disposals,
    taxable,
    allTaxable: allBitcoin(holdings(state), 7_500_000).taxable,
    years: YEARS.map((y) => ({ s: yearSummary(state, y), f8949: form8949Csv(state, y), tax: taxForYear(taxInput(taxContext(state, state.settings, y, `${y}-12-31`), 0, 0)) })),
    plan: planSale(state, state.settings, { wallet: 'ex', sats: 1_000_000, priceCents: 7_500_000, onDate: '2026-12-31', year: 2026 }),
    cpa: state.cpaFlags,
    errors: state.errors.filter((e) => !e.entryId.startsWith('Q')),
  };
}

describe('retirement properties', () => {
  test('adding or removing retirement purchases (edits, deletes and bad ones included) never changes any tax output', () => {
    fc.assert(
      fc.property(fc.array(coinArb, { minLength: 1, maxLength: 8 }), fc.array(sellArb, { maxLength: 5 }), fc.array(retArb, { minLength: 1, maxLength: 8 }), (coins, sells, rets) => {
        const plain = coinHistory(coins, sells);
        const withRetirement = [...plain, ...retirementRecords(rets, coins.length)];
        expect(taxView(replay(withRetirement))).toEqual(taxView(replay(plain)));
        // Input order never matters.
        expect(taxView(replay([...withRetirement].reverse()))).toEqual(taxView(replay(plain)));
      }),
      { numRuns: 200 },
    );
  });
});
