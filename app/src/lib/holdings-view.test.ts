import { holdings, loanPurchases, loanSummary, replay, retirementPurchases, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_PRICE_CENTS, DEMO_TODAY } from '../demo/demo-data.ts';
import { averageLines, buildHoldingsView } from './holdings-view.ts';
import { sumWorth } from './worth-now.ts';

describe('Holdings: every worth is lot by lot, so the parts add up to the totals', () => {
  const state = replay(buildDemoBook().entries);
  const view = buildHoldingsView(state, holdings(state), DEMO_PRICE_CENTS, DEMO_TODAY);

  it('the taxable worth is the year rows added up, to the cent', () => {
    // Before: sats × price on the total ($319,206.90) against the lots added up ($319,206.94).
    const rows = view.stack.reduce((t, r) => t + (sumWorth(r.lots, DEMO_PRICE_CENTS).valueCents as number), 0);
    expect(view.worthCents).toBe(rows);
    expect(view.worthCents).toBe(31_920_694);
    expect(view.all?.taxable.valueCents).toBe(view.worthCents);
    expect(view.gainCents).toBe(view.all?.taxable.gainCents);
  });

  it('retirement is its purchases added up; taxable plus retirement is the total', () => {
    const all = view.all;
    if (all === null) throw new Error('the demo has a retirement wallet');
    const purchases = retirementPurchases(state, null, DEMO_PRICE_CENTS, DEMO_TODAY).reduce((t, p) => t + (p.valueCents as number), 0);
    expect(all.retirement.valueCents).toBe(purchases);
    expect(view.retirement.reduce((t, r) => t + (r.worth.valueCents as number), 0)).toBe(purchases);
    expect(all.total.valueCents).toBe((all.taxable.valueCents as number) + (all.retirement.valueCents as number));
  });

  it('the Taxable and Retirement rows add up to the hero in whole dollars, and the gain card matches the Taxable row', () => {
    const { all, split } = view;
    if (all === null || split === null) throw new Error('the demo has a retirement wallet');
    const dollars = (c: number | null) => Math.trunc((c as number) / 100);
    expect(dollars(split.taxable.valueCents) + dollars(split.retirement.valueCents)).toBe(dollars(all.total.valueCents));
    expect(dollars(split.taxable.gainCents) + dollars(split.retirement.gainCents)).toBe(dollars(all.total.gainCents));
    // $319,206.94 + $33,184.34 = $352,391.28: $319,207 + $33,184 (was $319,206 + $33,184 under $352,391).
    expect([split.taxable.valueCents, split.retirement.valueCents]).toEqual([31_920_700, 3_318_400]);
    expect(view.taxableGainShownCents).toBe(split.taxable.gainCents);
    // The Retirement card's one wallet shows the Retirement row's figures.
    expect(view.retirement.map((r) => [r.shown.valueCents, r.shown.gainCents])).toEqual([[split.retirement.valueCents, split.retirement.gainCents]]);
  });

  it('a loan’s coins are worth the same here as on the loan page', () => {
    for (const loan of state.loans) {
      const s = loanSummary(state, loan.id, DEMO_PRICE_CENTS, DEMO_TODAY);
      const lots = loanPurchases(state, loan.id, DEMO_PRICE_CENTS, DEMO_TODAY);
      expect(s?.valueCents).toBe(lots.reduce((t, p) => t + (p.valueCents as number), 0));
    }
  });

  it('documentation shares add up to 100% and never claim all of it when some is not', () => {
    expect(view.tierShares).toEqual({ documented: '94%', reconstructed: '6%', estimated: '0%', unknown: '0%' });
  });
});

describe('Holdings: losses from past years', () => {
  const TZ = 'America/Boise';
  const book = (patch: Record<string, unknown>) => {
    const state = replay([
      { id: 'w', kind: 'wallet', at: '2025-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
      { id: 's', kind: 'settings', at: '2025-06-01T19:00:00Z', tz: TZ, patch } as never,
    ]);
    return buildHoldingsView(state, holdings(state), DEMO_PRICE_CENTS, '2026-11-20');
  };
  it('asks to update them when only an earlier year’s are saved, as Sell and Tax season do', () => {
    expect(book({ carryforwardByYear: { '2025': { st: 0, lt: 100_000 } } })).toMatchObject({ carryforwardCents: 0, staleLossesFor: 2025 });
    expect(book({ carryforwardByYear: { '2026': { st: 0, lt: 100_000 } } })).toMatchObject({ carryforwardCents: 100_000, staleLossesFor: null });
  });
});

describe('Holdings: your stack by year bought is all your Bitcoin, taxable and retirement', () => {
  const state = replay(buildDemoBook().entries);
  const view = buildHoldingsView(state, holdings(state), DEMO_PRICE_CENTS, DEMO_TODAY);
  const all = view.all;
  if (all === null) throw new Error('the demo has a retirement wallet');

  it('each year has its retirement purchases, by their date, beside the taxable lots', () => {
    const byYear = Object.fromEntries(view.stack.map((r) => [r.year, r.retirementSats]));
    // The demo's three retirement purchases: 0.15 BTC in 2022, 0.165 in 2024, 0.035 in 2026.
    expect(byYear).toEqual({ 2022: 15_000_000, 2023: 0, 2024: 16_500_000, 2025: 0, 2026: 3_500_000 });
    for (const r of view.stack) {
      expect(r.sats).toBe(r.taxableSats + r.retirementSats);
      expect(r.taxableSats).toBe(r.lots.reduce((t, l) => t + l.sats, 0));
      expect(r.retirementSats).toBe(r.retirement.reduce((t, p) => t + p.sats, 0));
      // The tiers are the taxable lots only: retirement has no tax tier.
      expect(Object.values(r.byTier).reduce((t, s) => t + s, 0)).toBe(r.taxableSats);
      expect(r.pieces).toHaveLength(r.lots.length + r.retirement.length);
    }
    expect(view.stack.find((r) => r.year === 2024)?.retirement.map((p) => [p.date, p.walletName])).toEqual([['2024-01-18', 'Retirement account']]);
  });

  it('the year totals add up to the hero’s BTC; the taxable parts to the taxable total', () => {
    expect(view.stackUndated).toBeNull();
    expect(view.stack.reduce((t, r) => t + r.sats, 0)).toBe(all.total.sats);
    expect(view.stack.reduce((t, r) => t + r.taxableSats, 0)).toBe(view.totalSats);
    expect(view.stack.reduce((t, r) => t + r.retirementSats, 0)).toBe(all.retirement.sats);
  });

  it('each year sheet lists lots and retirement purchases together, newest first', () => {
    for (const r of view.stack) {
      const times = r.pieces.map((p) => Date.parse(p.kind === 'lot' ? p.lot.acquiredAt : p.purchase.at));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    }
    const kinds = view.stack.find((r) => r.year === 2026)?.pieces.map((p) => p.kind) ?? [];
    expect(kinds).toContain('retirement');
    expect(kinds.indexOf('retirement')).toBeGreaterThan(0);
  });

  it('the documented share stays about the taxable lots only', () => {
    expect(view.tierShares.documented).toBe('94%');
    expect(Object.values(view.mix).reduce((t, s) => t + s, 0)).toBe(view.totalSats);
  });
});

describe('Holdings: retirement with balance notes only has no year', () => {
  const TZ = 'America/Boise';
  const base: Entry[] = [
    { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
    { id: 'w2', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ira', name: 'Old IRA', type: 'retirement', defaultProof: '' },
    { id: 'w3', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'k', name: 'New 401k', type: 'retirement', defaultProof: '' },
    { id: 'b1', kind: 'buy', at: '2024-02-01T19:00:00Z', tz: TZ, wallet: 'ex', sats: 50_000_000, costCents: 2_000_000, tier: 'reconstructed' },
    { id: 's1', kind: 'retirement-snapshot', at: '2025-04-01T19:00:00Z', tz: TZ, wallet: 'ira', sats: 12_000_000 },
  ];
  const viewOf = (entries: Entry[]) => {
    const state = replay(entries);
    return buildHoldingsView(state, holdings(state), 10_000_000, '2026-11-20');
  };

  it('is set apart, with its wallets named, and the years plus it add up to the hero', () => {
    const view = viewOf(base);
    expect(view.stack.map((r) => [r.year, r.taxableSats, r.retirementSats])).toEqual([[2024, 50_000_000, 0]]);
    expect(view.stackUndated).toEqual({ sats: 12_000_000, wallets: ['Old IRA'] });
    expect(view.stack.reduce((t, r) => t + r.sats, 0) + (view.stackUndated?.sats ?? 0)).toBe(view.all?.total.sats);
  });

  it('a wallet with purchases goes by year; one with notes only stays apart', () => {
    const view = viewOf([...base, { id: 'r1', kind: 'retirement-buy', at: '2025-03-01T19:00:00Z', tz: TZ, wallet: 'k', sats: 10_000_000, costCents: 500_000 }]);
    expect(view.stack.map((r) => [r.year, r.taxableSats, r.retirementSats])).toEqual([
      [2024, 50_000_000, 0],
      [2025, 0, 10_000_000],
    ]);
    expect(view.stack[1]?.lots).toEqual([]);
    expect(view.stackUndated).toEqual({ sats: 12_000_000, wallets: ['Old IRA'] });
    expect(view.stack.reduce((t, r) => t + r.sats, 0) + (view.stackUndated?.sats ?? 0)).toBe(view.all?.total.sats);
    // Retirement purchases never move the documented share: the taxable lot is reconstructed, so 0% documented.
    expect(view.tierShares).toMatchObject({ documented: '0%', reconstructed: '100%' });
  });

  it('nothing is set apart without notes-only retirement coins', () => {
    const view = viewOf(base.filter((e) => e.kind !== 'retirement-snapshot'));
    expect(view.stackUndated).toBeNull();
    expect(view.all).toBeNull();
  });
});

describe('Holdings: the chart’s average-cost lines', () => {
  it('with retirement coins: all, taxable and retirement, each its own average, all first', () => {
    const state = replay(buildDemoBook().entries);
    const view = buildHoldingsView(state, holdings(state), DEMO_PRICE_CENTS, DEMO_TODAY);
    const all = view.all;
    if (all === null) throw new Error('the demo has a retirement wallet');
    const lines = averageLines(view);
    expect(lines.map((l) => [l.basis, l.label, l.caption])).toEqual([
      ['all', 'All', 'Average cost of all your Bitcoin'],
      ['taxable', 'Taxable', 'Average cost of your taxable Bitcoin'],
      ['retirement', 'Retirement', 'Average cost of your retirement Bitcoin'],
    ]);
    const per = (cost: number, sats: number) => Math.round((cost * 100_000_000) / sats);
    expect(lines[0]?.centsPerBtc).toBe(per(all.total.costCents, all.total.sats));
    expect(lines[1]?.centsPerBtc).toBe(view.averageCostCentsPerBtc);
    expect(lines[2]?.centsPerBtc).toBe(per(all.retirement.costCents, all.retirement.sats));
    // Each is a weighted average, so all of it lies between the parts.
    const [a, t, r] = lines.map((l) => l.centsPerBtc) as [number, number, number];
    expect(a).toBeGreaterThanOrEqual(Math.min(t, r));
    expect(a).toBeLessThanOrEqual(Math.max(t, r));
  });

  it('without retirement coins: just your average cost; with some retirement cost not logged, no All or Retirement line', () => {
    const TZ = 'America/Boise';
    const base: Entry[] = [
      { id: 'w', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
      { id: 'b', kind: 'buy', at: '2024-02-01T19:00:00Z', tz: TZ, wallet: 'ex', sats: 10_000_000, costCents: 400_000, tier: 'documented' } as Entry,
      { id: 'w2', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ira', name: 'IRA', type: 'retirement', defaultProof: '' },
    ];
    const plain = replay(base);
    expect(averageLines(buildHoldingsView(plain, holdings(plain), DEMO_PRICE_CENTS, DEMO_TODAY)).map((l) => [l.basis, l.caption, l.centsPerBtc])).toEqual([['taxable', 'Your average cost', 4_000_000]]);
    const notes = replay([...base, { id: 's', kind: 'retirement-snapshot', at: '2024-04-01T19:00:00Z', tz: TZ, wallet: 'ira', sats: 5_000_000 } as Entry]);
    expect(averageLines(buildHoldingsView(notes, holdings(notes), DEMO_PRICE_CENTS, DEMO_TODAY)).map((l) => l.basis)).toEqual(['taxable']);
  });
});
