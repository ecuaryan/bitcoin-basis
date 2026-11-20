/** Sell planner, giving and borrow edge cases (from an adversarial review). Synthetic data only. */
import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, replay } from '../src/replay.ts';
import { givingDue, givingPercentBp, planBorrow, planSale, taxContext, TIER_NOTE } from '../src/planner/index.ts';
import type { Entry, Settings } from '../src/types.ts';
import { parseEntry } from '../src/validate.ts';
import { buy, cents, noon, pick, receive, sats, sell, TZ, wallet } from './helpers.ts';

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

describe('giving (Decision 16)', () => {
  test('giving due counts logged sells and spending (spending realizes a gain like a sale); fees do not', () => {
    const s: Settings = { ...SETTINGS, givingEnabled: true };
    const state = replay([wallet('ex'), buy('B', 'ex', '2024-01-01', '1', '10000'), sell('SP', 'ex', '2026-03-01', [pick('B', '0.5')], '40000', true)]);
    // Gain $35,000 at 10%.
    expect(givingDue(state, s, 2026).dueCents).toBe(cents('3500'));
  });
  test('the giving percent is stored as whole basis points, so 1.005% is not representable and 101 is', () => {
    expect(givingPercentBp({ givingPercentBp: 101 })).toBe(101);
    const patch = (p: number): boolean => parseEntry({ id: 'x', kind: 'settings', at: noon('2026-01-01'), tz: TZ, patch: { givingPercentBp: p } }).ok;
    expect([patch(100.5), patch(101)]).toEqual([false, true]);
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
});
