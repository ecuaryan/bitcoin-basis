/** Gifts: lowest cost first (spec: Disposals, "Lowest cost first"), with unit and property tests. All data is made up. */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { lowestCostFirst, lowestCostOrder, oldestFirstOrder, satsGivenBelowCost } from '../src/picks.ts';
import { replay } from '../src/replay.ts';
import type { Entry, Lot } from '../src/types.ts';
import { buy, cents, give, pick, sats, testBook, TZ, wallet } from './helpers.ts';

const lot = (id: string, acquiredDate: string, s: number, cost: number, extra: Partial<Lot> = {}): Lot => ({
  id,
  wallet: 'ex',
  sats: s,
  costCents: cost,
  acquiredDate,
  acquiredAt: `${acquiredDate}T12:00:00Z`,
  tier: 'documented',
  proof: '',
  originEntryId: id,
  alwaysLongTerm: false,
  tz: TZ,
  lossBasis: null,
  ...extra,
});

describe('lowest cost first (gifts)', () => {
  test('orders by cost per BTC, not by total cost; ties oldest first; only open lots in the wallet', () => {
    const lots = [
      lot('big-cheap', '2025-01-01', 1_000_000, 500), // 0.0005 c/sat
      lot('small-dear', '2020-01-01', 10, 100), // 10 c/sat
      lot('tie-new', '2024-06-01', 100, 100),
      lot('tie-old', '2024-01-01', 200, 200),
      lot('other', '2019-01-01', 100, 0, { wallet: 'cold' }),
      lot('empty', '2019-01-01', 0, 0),
    ];
    expect(lowestCostOrder(lots, 'ex').map((l) => l.id)).toEqual(['big-cheap', 'tie-old', 'tie-new', 'small-dear']);
  });

  test('exact comparison in BigInt (cost × sats goes past 2^53)', () => {
    // 2,100,000,000,000,000 sats; costs differ by one cent.
    const a = lot('a', '2024-01-02', 2_100_000_000_000_000, 100_000_000_000_001);
    const b = lot('b', '2024-01-01', 2_100_000_000_000_000, 100_000_000_000_000);
    expect(lowestCostOrder([a, b], 'ex').map((l) => l.id)).toEqual(['b', 'a']);
  });

  test('test book: a 0.01 gift comes from L2, the lowest-cost lot ($22,500 per BTC), not L1 (oldest)', () => {
    const lots = replay(testBook()).lots;
    expect(lowestCostFirst(lots, 'ex', sats('0.01'))).toEqual({ ok: true, value: [pick('L2', '0.01')] });
    // L2 ($22,500), then L1 ($56,000), L4 ($88,000), L3 ($97,500).
    expect(lowestCostOrder(lots, 'ex').map((l) => l.id)).toEqual(['L2', 'L1', 'L4', 'L3']);
    expect(lowestCostFirst(lots, 'ex', sats('1.2') + 1).ok).toBe(false);
  });

  test('never gives a lot below cost when lots at or below the value can cover it', () => {
    // Price $75,000: L2 and L1 are at a gain, L3 and L4 at a loss.
    const lots = replay(testBook()).lots;
    const r = lowestCostFirst(lots, 'ex', sats('0.9'));
    expect(r).toEqual({ ok: true, value: [pick('L2', '0.4'), pick('L1', '0.5')] });
    expect(satsGivenBelowCost(lots, r.ok ? r.value : [], sats('0.9'), cents('67500'))).toBe(0);
  });

  test('only when they cannot cover it: the rest from the smallest loss per sat, and it is counted', () => {
    const lots = replay(testBook()).lots;
    const r = lowestCostFirst(lots, 'ex', sats('1.0'));
    expect(r).toEqual({ ok: true, value: [pick('L2', '0.4'), pick('L1', '0.5'), pick('L4', '0.1')] });
    expect(satsGivenBelowCost(lots, r.ok ? r.value : [], sats('1.0'), cents('75000'))).toBe(sats('0.1'));
  });

  test('break-even counts as not below cost; unknown lots count as zero', () => {
    const lots = [lot('even', '2024-01-01', 100, 50), lot('loss', '2024-01-01', 100, 51)];
    expect(satsGivenBelowCost(lots, [{ lotId: 'even', sats: 100 }], 100, 50)).toBe(0);
    expect(satsGivenBelowCost(lots, [{ lotId: 'loss', sats: 40 }], 40, 20)).toBe(40);
    expect(satsGivenBelowCost(lots, [{ lotId: 'missing', sats: 40 }], 40, 0)).toBe(0);
  });
});

// ---- Properties ------------------------------------------------------------------------

const lotArb = fc.record({
  w: fc.constantFrom('ex', 'cold'),
  sats: fc.integer({ min: 0, max: 200_000_000 }),
  cost: fc.integer({ min: 0, max: 20_000_000 }),
  day: fc.integer({ min: 0, max: 2000 }),
});
const lotsArb = fc.array(lotArb, { minLength: 0, maxLength: 12 }).map((xs) =>
  xs.map((x, i) => lot(`l${i}`, new Date(Date.UTC(2020, 0, 1) + x.day * 86_400_000).toISOString().slice(0, 10), x.sats, x.cost, { wallet: x.w })),
);
const RUNS = { numRuns: 1000 };

describe('lowest cost first: properties', () => {
  test('picks always cover the amount exactly, stay in the wallet and never exceed a lot', () => {
    fc.assert(
      fc.property(lotsArb, fc.integer({ min: 1, max: 1_000_000_000 }), (lots, want) => {
        const held = lots.filter((l) => l.wallet === 'ex').reduce((s, l) => s + l.sats, 0);
        const r = lowestCostFirst(lots, 'ex', want);
        if (want > held) return !r.ok && r.error.code === 'insufficient-sats';
        if (!r.ok) return false;
        const byId = new Map(lots.map((l) => [l.id, l]));
        const ids = new Set<string>();
        for (const p of r.value) {
          const l = byId.get(p.lotId);
          if (l === undefined || l.wallet !== 'ex' || p.sats <= 0 || p.sats > l.sats || ids.has(p.lotId)) return false;
          ids.add(p.lotId);
        }
        return r.value.reduce((s, p) => s + p.sats, 0) === want;
      }),
      RUNS,
    );
  });

  test('no lot below cost is used while lots at or below the value can cover the gift', () => {
    fc.assert(
      fc.property(lotsArb, fc.integer({ min: 1, max: 300_000_000 }), fc.integer({ min: 0, max: 20_000_000 }), (lots, want, priceCents) => {
        const r = lowestCostFirst(lots, 'ex', want);
        if (!r.ok) return true;
        const value = Math.round((want * priceCents) / 100_000_000);
        const atGain = lots.filter((l) => l.wallet === 'ex' && l.sats > 0 && BigInt(l.costCents) * BigInt(want) <= BigInt(value) * BigInt(l.sats));
        const canCover = atGain.reduce((s, l) => s + l.sats, 0) >= want;
        const below = satsGivenBelowCost(lots, r.value, want, value);
        return canCover ? below === 0 : below === want - Math.min(want, atGain.reduce((s, l) => s + l.sats, 0));
      }),
      RUNS,
    );
  });

  test('the order is the wallet’s open lots, cost per sat never going down', () => {
    fc.assert(
      fc.property(lotsArb, (lots) => {
        const order = lowestCostOrder(lots, 'ex');
        const same = new Set(order.map((l) => l.id));
        if (order.length !== oldestFirstOrder(lots, 'ex').length || ![...oldestFirstOrder(lots, 'ex')].every((l) => same.has(l.id))) return false;
        return order.every((l, i) => i === 0 || BigInt((order[i - 1] as Lot).costCents) * BigInt(l.sats) <= BigInt(l.costCents) * BigInt((order[i - 1] as Lot).sats));
      }),
      RUNS,
    );
  });

  test('a saved gift never changes when a cheaper or older purchase is added later', () => {
    const buysArb = fc.array(fc.record({ day: fc.integer({ min: 0, max: 900 }), sats: fc.integer({ min: 1, max: 100_000_000 }), cost: fc.integer({ min: 0, max: 10_000_000 }) }), { minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(buysArb, fc.integer({ min: 1, max: 100 }), fc.record({ day: fc.integer({ min: 0, max: 900 }), sats: fc.integer({ min: 1, max: 100_000_000 }), cost: fc.integer({ min: 0, max: 10_000 }) }), (buys, share, extra) => {
        const date = (d: number): string => new Date(Date.UTC(2023, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
        const book: Entry[] = [wallet('ex'), ...buys.map((b, i) => ({ ...buy(`b${i}`, 'ex', date(b.day), '0', '0'), sats: b.sats, costCents: b.cost }))];
        const held = buys.reduce((s, b) => s + b.sats, 0);
        const want = Math.max(1, Math.floor((held * share) / 100));
        const r = lowestCostFirst(replay(book).lots, 'ex', want);
        if (!r.ok) return false;
        const gift = give('g', 'ex', '2026-01-01', r.value, '100', 'person', 'Sam');
        const saved = replay([...book, gift]).gifts.find((g) => g.entryId === 'g');
        const later = replay([...book, gift, { ...buy('cheap', 'ex', date(extra.day), '0', '0'), sats: extra.sats, costCents: extra.cost }]).gifts.find((g) => g.entryId === 'g');
        expect(saved).toBeDefined();
        expect(later).toEqual(saved);
        return true;
      }),
      { numRuns: 300 },
    );
  });
});
