/** Sell planner and borrow edge cases (from an adversarial review). Synthetic data only. */
import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, replay } from '../src/replay.ts';
import { isBetterPlan, planBorrow, planSale, taxContext, TIER_NOTE, type SalePlan } from '../src/planner/index.ts';
import type { Entry, Settings } from '../src/types.ts';
import { buy, cents, noon, pick, receive, sats, TZ, wallet } from './helpers.ts';

const DATE = '2026-11-15';
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, filingStatus: 'married-joint', wagesCents: cents('130000') };

describe('lowest tax stays tier-first, and says so when oldest first is cheaper', () => {
  test('an older Estimated lot at a loss vs a newer Documented lot at a gain', () => {
    const state = replay([wallet('ex'), buy('E', 'ex', '2021-01-01', '1', '80000', 'estimated'), buy('D', 'ex', '2023-01-01', '1', '20000')]);
    const r = planSale(state, SETTINGS, { wallet: 'ex', sats: sats('0.5'), priceCents: cents('75000'), onDate: DATE, year: 2026 });
    if (!r.ok) throw new Error(r.error.message);
    // Oldest first sells E (−$2,500 long); lowest tax sells D (+$27,500 long) because tiers outrank tax.
    expect(r.value.oldestFirst.totalTaxCents).toBeLessThan(r.value.lowestTax.totalTaxCents);
    expect(r.value.lowestTax.picks).toEqual([pick('D', '0.5')]);
    expect(r.value.lowestTax.note).toBe(TIER_NOTE);
    expect(r.value.oldestFirst.note).toBeNull();
  });
  test('no note when lowest tax is not more expensive', () => {
    const state = replay([wallet('ex'), buy('A', 'ex', '2021-01-01', '1', '20000'), buy('B', 'ex', '2023-01-01', '1', '80000')]);
    const r = planSale(state, SETTINGS, { wallet: 'ex', sats: sats('0.5'), priceCents: cents('75000'), onDate: DATE, year: 2026 });
    expect(r.ok && r.value.lowestTax.note).toBeNull();
  });
  test('plans other than oldest first need a coin instruction to the exchange (Reg. 1.1012-1(j)(3))', () => {
    const state = replay([wallet('ex'), buy('A', 'ex', '2021-01-01', '1', '20000')]);
    const r = planSale(state, SETTINGS, { wallet: 'ex', sats: sats('0.5'), priceCents: cents('75000'), onDate: DATE, year: 2026, handPicks: [pick('A', '0.5')] });
    if (!r.ok) throw new Error(r.error.message);
    expect([r.value.oldestFirst, r.value.lowestTax, r.value.handPicked].map((p) => p?.brokerInstructionNeeded)).toEqual([false, true, true]);
  });
});

describe('borrow', () => {
  const state = replay([wallet('cel'), wallet('ex'), buy('B', 'cel', '2023-01-01', '1', '20000'), buy('E', 'ex', '2023-01-01', '1', '20000'), { id: 'F', kind: 'wallet-freeze', at: noon('2025-01-01'), tz: TZ, wallet: 'cel' } as Entry]);
  const ctx = taxContext(state, SETTINGS, 2026, DATE);
  const base = { ...ctx, loanCents: cents('25000'), ratePerYear: 1000, marginCallLtv: 7000, liquidationLtv: 8000, pledgedSats: sats('1'), priceCents: cents('75000'), lots: state.lots, wallets: state.wallets, wallet: 'cel' };
  test('pledging coins from a frozen wallet is refused', () => {
    expect(planBorrow(base)).toMatchObject({ ok: false, error: { code: 'wallet-frozen' } });
  });
  test('a pledge larger than the wallet holds is refused', () => {
    expect(planBorrow({ ...base, wallet: 'ex', pledgedSats: sats('5') })).toMatchObject({ ok: false, error: { code: 'insufficient-sats' } });
  });
  test('trigger prices are always safe integers, or the plan is refused', () => {
    const r = planBorrow({ ...base, wallet: 'ex', loanCents: 1_000_000, pledgedSats: 1, marginCallLtv: 1, liquidationLtv: 10_000 });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  });
});

describe('sale request validation', () => {
  const state = replay([wallet('ex'), buy('B', 'ex', '2023-01-01', '1', '20000')]);
  const req = { wallet: 'ex', sats: sats('0.5'), priceCents: 100, onDate: DATE, year: 2026 };
  test.each([
    ['a negative price', { priceCents: -100 }],
    ['a zero price', { priceCents: 0 }],
    ['onDate outside year', { onDate: '2027-01-05' }],
    ['onDate not a date', { onDate: '2026-02-30' }],
  ])('%s is refused', (_name, over) => {
    expect(planSale(state, SETTINGS, { ...req, ...over })).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  });
  test('a sale over $1 trillion is too large to plan', () => {
    expect(planSale(state, SETTINGS, { ...req, priceCents: 1_000_000_000_000_000 })).toMatchObject({ ok: false, error: { message: 'the sale is too large to plan' } });
  });
  test('dual-basis gift lots use the dual-basis rule in plans too', () => {
    const g = replay([wallet('ex'), receive('G', 'ex', '2026-01-10', '0.1', '6000', { type: 'gift', giverCostCents: cents('10000'), giverAcquiredAt: noon('2022-01-01') })]);
    const r = planSale(g, SETTINGS, { wallet: 'ex', sats: sats('0.1'), priceCents: cents('80000'), onDate: DATE, year: 2026 });
    expect(r.ok && [r.value.oldestFirst.gainCents, r.value.oldestFirst.costCents]).toEqual([0, cents('8000')]);
  });
  test('each lot’s piece of a dual-basis gift carries the basis the rule used, so proceeds − cost is the gain', () => {
    // Given at $6,000, giver paid $10,000 in 2022. Sold at $5,000: a loss from the $6,000 value, dated at the gift.
    const g = replay([wallet('ex'), receive('G', 'ex', '2026-01-10', '0.1', '6000', { type: 'gift', giverCostCents: cents('10000'), giverAcquiredAt: noon('2022-01-01') })]);
    const r = planSale(g, SETTINGS, { wallet: 'ex', sats: sats('0.1'), priceCents: cents('50000'), onDate: DATE, year: 2026 });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.oldestFirst.pieces).toEqual([{ lotId: 'G', sats: sats('0.1'), costCents: cents('6000'), acquiredDate: '2026-01-10', tier: 'documented', term: 'short', inherited: false, proceedsCents: cents('5000'), gainCents: cents('-1000') }]);
    expect(r.value.oldestFirst.stGainCents).toBe(cents('-1000'));
    // Sold at $12,000: a gain from the giver's $10,000 cost and date.
    const up = planSale(g, SETTINGS, { wallet: 'ex', sats: sats('0.1'), priceCents: cents('120000'), onDate: DATE, year: 2026 });
    expect(up.ok && up.value.oldestFirst.pieces[0]).toMatchObject({ costCents: cents('10000'), acquiredDate: '2022-01-01', term: 'long', proceedsCents: cents('12000'), gainCents: cents('2000') });
  });
  test('pieces add up to the plan: sats, cost, proceeds (split by sats) and gain by term', () => {
    const state = replay([wallet('ex'), buy('A', 'ex', '2021-01-01', '0.3333', '10000'), buy('B', 'ex', '2026-03-01', '0.3333', '30000'), buy('C', 'ex', '2026-04-01', '0.3334', '33333.33')]);
    const r = planSale(state, SETTINGS, { wallet: 'ex', sats: sats('0.7777'), priceCents: cents('77777.77'), onDate: DATE, year: 2026 });
    if (!r.ok) throw new Error(r.error.message);
    for (const plan of [r.value.oldestFirst, r.value.lowestTax]) {
      const total = (f: (p: (typeof plan.pieces)[number]) => number): number => plan.pieces.reduce((s, p) => s + f(p), 0);
      expect(plan.pieces.map((p) => ({ lotId: p.lotId, sats: p.sats }))).toEqual(plan.picks);
      expect(total((p) => p.sats)).toBe(sats('0.7777'));
      expect(total((p) => p.costCents)).toBe(plan.costCents);
      expect(total((p) => p.proceedsCents)).toBe(plan.proceedsCents);
      expect(total((p) => (p.term === 'short' ? p.gainCents : 0))).toBe(plan.stGainCents);
      expect(total((p) => (p.term === 'long' ? p.gainCents : 0))).toBe(plan.ltGainCents);
      for (const p of plan.pieces) expect(p.proceedsCents - p.costCents).toBe(p.gainCents);
      expect(plan.federalTaxCents + plan.stateTaxCents).toBe(plan.totalTaxCents);
      expect(plan.afterTaxCents).toBe(plan.proceedsCents - plan.totalTaxCents);
    }
  });
  test('isBetterPlan: less tax wins; at equal tax, more loss left for next year; equal on both, neither', () => {
    const p = (tax: number, st: number, lt: number): SalePlan => ({ totalTaxCents: tax, carryforwardOut: { st, lt } }) as SalePlan;
    expect(isBetterPlan(p(100, 0, 0), p(200, 0, 0))).toBe(true);
    expect(isBetterPlan(p(200, 0, 0), p(100, 900, 0))).toBe(false);
    expect(isBetterPlan(p(-50, 0, 10), p(-50, 5, 0))).toBe(true);
    expect(isBetterPlan(p(-50, 5, 0), p(-50, 0, 10))).toBe(false);
    expect(isBetterPlan(p(-50, 5, 5), p(-50, 0, 10))).toBe(false);
    expect(isBetterPlan(p(-50, 0, 10), p(-50, 5, 5))).toBe(false);
  });
});
