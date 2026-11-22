import { holdings, loanPurchases, loanSummary, replay, retirementPurchases } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_PRICE_CENTS, DEMO_TODAY } from '../demo/demo-data.ts';
import { buildHoldingsView } from './holdings-view.ts';
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
    // Held apart's one retirement wallet shows the Retirement row's figures.
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
