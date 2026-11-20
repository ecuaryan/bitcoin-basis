import { averageCostPerBtc, formatBtc, holdings, replay } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, W } from './demo-data.ts';

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
