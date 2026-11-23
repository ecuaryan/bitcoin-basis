import { averageCostPerBtc, formatBtc, holdings, replay } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_PRICE_CENTS, DEMO_TODAY, demoPriceSeries, W } from './demo-data.ts';

describe('demo book', () => {
  const book = buildDemoBook();
  const state = replay(book.entries);
  const h = holdings(state);

  it('replays without errors', () => {
    expect(state.errors).toEqual([]);
    expect(state.conflicts).toEqual([]);
  });

  it('is 2.1 BTC in all: 1.85 taxable plus 0.25 in retirement', () => {
    expect(formatBtc(h.totalSats)).toBe('1.85000000');
    expect(h.retirement[0]?.sats).toBe(25_000_000);
    expect(h.totalSats + (h.retirement[0]?.sats ?? 0)).toBe(210_000_000);
    expect(h.averageCostCentsPerBtc).toBe(4_125_018);
    expect(averageCostPerBtc(h.totalCostCents, h.totalSats)).toBe(4_125_018);
    const docPct = Math.round((h.documentationMix.documented * 100) / h.totalSats);
    expect(docPct).toBe(94);
  });

  it('is small enough to take in: two wallets, no frozen one, a few dozen lots', () => {
    expect(h.wallets.filter((w) => w.sats > 0).map((w) => w.wallet).sort()).toEqual([W.cold, W.strike].sort());
    expect(h.wallets.some((w) => w.frozen)).toBe(false);
    expect(state.lots.length).toBeLessThan(60);
  });

  it('is the same every time', () => {
    expect(buildDemoBook().entries).toBe(book.entries);
  });
});

describe('demo retirement account', () => {
  it('has purchases that add up to its latest balance note', () => {
    const state = replay(buildDemoBook().entries);
    const r = holdings(state).retirement.find((x) => x.wallet === W.retirement);
    expect(r?.purchaseCount).toBe(3);
    expect(r?.balanceFrom).toBe('purchases');
    expect(r?.snapshot?.matches).toBe(true);
    expect(r?.sats).toBe(25_000_000);
  });
});

describe('demo price series (the chart)', () => {
  const end = Date.parse(`${DEMO_TODAY}T16:00:00Z`);
  const days = demoPriceSeries(end, 1095);

  it('one whole UTC day each, oldest first, ending today at today\'s price, integers only', () => {
    expect(days).toHaveLength(1095);
    expect(days.at(-1)).toMatchObject({ dayMs: Date.parse(`${DEMO_TODAY}T00:00:00Z`), closeCents: DEMO_PRICE_CENTS });
    for (const d of days) {
      expect(d.dayMs % 86_400_000).toBe(0);
      expect(Number.isSafeInteger(d.closeCents) && Number.isSafeInteger(d.highCents) && d.highCents >= d.closeCents).toBe(true);
    }
  });

  it('moves like a market: a few percent a day at most, with a high before today', () => {
    for (let i = 1; i < days.length; i++) {
      const a = days[i - 1]?.closeCents ?? 0;
      const b = days[i]?.closeCents ?? 0;
      expect(Math.abs(b - a) / a).toBeLessThan(0.05);
    }
    const peak = days.reduce((best, d) => (d.highCents > best.highCents ? d : best));
    expect(peak.dayMs).toBeLessThan(end - 14 * 86_400_000);
    expect(peak.highCents).toBeGreaterThan(DEMO_PRICE_CENTS);
    // The same every time.
    expect(demoPriceSeries(end, 1095)).toEqual(days);
  });
});
