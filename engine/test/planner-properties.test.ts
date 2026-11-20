/** Planner properties over random synthetic books. */
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { planSale } from '../src/planner/index.ts';
import { replay, DEFAULT_SETTINGS } from '../src/replay.ts';
import { TIERS, type Entry, type Settings } from '../src/types.ts';
import { noon, TZ, wallet } from './helpers.ts';

const lotArb = fc.record({
  sats: fc.integer({ min: 1_000, max: 200_000_000 }),
  cost: fc.integer({ min: 0, max: 20_000_000_00 }),
  day: fc.integer({ min: 0, max: 2500 }),
});

function dateOf(day: number): string {
  return new Date(Date.UTC(2019, 11, 1) + day * 86_400_000).toISOString().slice(0, 10);
}

test('plans use exactly the sats, from the chosen wallet only; lowest tax is never dearer when tiers match', () => {
  fc.assert(
    fc.property(
      fc.array(lotArb, { minLength: 1, maxLength: 6 }),
      fc.array(lotArb, { maxLength: 3 }),
      fc.double({ min: 0.01, max: 1, noNaN: true }),
      fc.integer({ min: 50_000_00, max: 20_000_000_00 }),
      fc.integer({ min: 0, max: 400_000_00 }),
      fc.constantFrom<Settings['filingStatus']>('single', 'married-joint', 'head-of-household'),
      fc.integer({ min: 0, max: 5_000_000 }),
      fc.constantFrom(...TIERS),
      (lots, otherLots, fraction, price, wages, filingStatus, carry, tier) => {
        const entries: Entry[] = [wallet('ex'), wallet('other')];
        lots.forEach((l, i) => entries.push({ id: `a${i}`, kind: 'buy', at: noon(dateOf(l.day)), tz: TZ, wallet: 'ex', sats: l.sats, costCents: l.cost, tier }));
        otherLots.forEach((l, i) => entries.push({ id: `b${i}`, kind: 'buy', at: noon(dateOf(l.day)), tz: TZ, wallet: 'other', sats: l.sats, costCents: l.cost, tier }));
        const state = replay(entries);
        const held = lots.reduce((s, l) => s + l.sats, 0);
        const sats = Math.max(1, Math.floor(held * fraction));
        const settings: Settings = { ...DEFAULT_SETTINGS, filingStatus, wagesCents: wages, carryforwardLtCents: carry };
        const r = planSale(state, settings, { wallet: 'ex', sats, priceCents: price, onDate: '2026-11-15', year: 2026 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const inEx = new Set(state.lots.filter((l) => l.wallet === 'ex').map((l) => l.id));
        for (const plan of [r.value.oldestFirst, r.value.lowestTax]) {
          expect(plan.picks.reduce((s, p) => s + p.sats, 0)).toBe(sats);
          expect(plan.picks.every((p) => inEx.has(p.lotId))).toBe(true);
          expect(new Set(plan.picks.map((p) => p.lotId)).size).toBe(plan.picks.length);
        }
        expect(r.value.lowestTax.totalTaxCents).toBeLessThanOrEqual(r.value.oldestFirst.totalTaxCents);
      },
    ),
    { numRuns: 1000 },
  );
});
