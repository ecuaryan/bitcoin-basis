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

  it('matches the design figures', () => {
    expect(formatBtc(h.totalSats)).toBe('3.36672105');
    const sats = (id: string) => h.wallets.find((w) => w.wallet === id)?.sats;
    expect(sats(W.cold)).toBe(261_003_422);
    expect(sats(W.strike)).toBe(61_882_140);
    expect(sats(W.river)).toBe(13_786_543);
    expect(h.averageCostCentsPerBtc).toBe(4_125_018);
    expect(averageCostPerBtc(h.totalCostCents, h.totalSats)).toBe(4_125_018);
    expect(state.lots.filter((l) => l.wallet !== W.harbor)).toHaveLength(186);
    const docPct = Math.round((h.documentationMix.documented * 100) / h.totalSats);
    expect(docPct).toBe(94);
  });

  it('has a frozen wallet and a retirement wallet kept apart', () => {
    expect(h.wallets.find((w) => w.wallet === W.harbor)?.frozen).toBe(true);
    expect(h.retirement[0]?.sats).toBeGreaterThan(0);
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
    expect(r?.sats).toBe(35_000_000);
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
