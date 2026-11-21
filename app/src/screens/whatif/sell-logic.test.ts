import { replay, type Entry, type SellEntry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_PRICE_CENTS, DEMO_TODAY, W } from '../../demo/demo-data.ts';
import { computeEffect, trialReplay } from '../log/model.ts';
import { defaultSats, planForWallet, stepFor } from './sell-logic.ts';

describe('What if amount', () => {
  it('starts on 0.25 BTC, or a round quarter of a small wallet', () => {
    expect(defaultSats(61_880_000)).toBe(25_000_000);
    expect(defaultSats(7_420_000)).toBe(1_000_000);
    expect(defaultSats(3)).toBe(3);
  });
  it('steps by 0.01 BTC for a big wallet and finer for a small one', () => {
    expect(stepFor(61_880_000)).toBe(1_000_000);
    expect(stepFor(7_420_000)).toBe(100_000);
  });
});

describe('What if sale review', () => {
  const book = buildDemoBook();
  const state = replay(book.entries);
  const year = Number(DEMO_TODAY.slice(0, 4));

  // The tax the review shows before you save must be the planner's incrementalTax for the same coins and price.
  for (const carry of [false, true]) {
    it(`shows the planner's tax for each plan${carry ? ' with losses carried forward' : ''}`, () => {
      const settings = { ...state.settings, wagesCents: 12_000_000, ...(carry ? { carryforwardStCents: 300_000, carryforwardLtCents: 500_000 } : {}) };
      const withSettings = { ...state, settings };
      const r = planForWallet(withSettings, settings, { wallet: W.strike, sats: 25_000_000, priceCents: DEMO_PRICE_CENTS, onDate: DEMO_TODAY, year }).plans;
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const plan of [r.value.oldestFirst, r.value.lowestTax]) {
        const sell: SellEntry = {
          id: 'what-if-sale',
          kind: 'sell',
          at: `${DEMO_TODAY}T19:00:00Z`,
          tz: settings.timeZone,
          wallet: W.strike,
          sats: 25_000_000,
          proceedsCents: plan.proceedsCents,
          picks: plan.picks,
          spent: false,
        };
        const trial = trialReplay(book.entries as Entry[], withSettings, [sell]);
        expect(trial.problems).toEqual([]);
        const effect = computeEffect(sell, trial.before, trial.after);
        expect(effect.taxCents).toBe(plan.totalTaxCents);
      }
    });
  }

  it('matches on a book where the sale really owes tax', () => {
    const wallet: Entry = { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: 'America/Boise', wallet: 'ex', name: 'Ex', type: 'exchange', defaultProof: '' };
    const buy = (id: string, at: string, sats: number, costCents: number): Entry => ({ id, kind: 'buy', at, tz: 'America/Boise', wallet: 'ex', sats, costCents, tier: 'documented' });
    const entries = [wallet, buy('b1', '2024-02-01T17:00:00Z', 50_000_000, 2_000_000), buy('b2', '2026-03-01T17:00:00Z', 30_000_000, 2_400_000)];
    const small = replay(entries);
    const settings = { ...small.settings, wagesCents: 12_000_000 };
    const st = { ...small, settings };
    const r = planForWallet(st, settings, { wallet: 'ex', sats: 60_000_000, priceCents: 10_000_000, onDate: DEMO_TODAY, year }).plans;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oldestFirst.totalTaxCents).toBeGreaterThan(0);
    for (const plan of [r.value.oldestFirst, r.value.lowestTax]) {
      const sell: SellEntry = { id: 's1', kind: 'sell', at: `${DEMO_TODAY}T19:00:00Z`, tz: settings.timeZone, wallet: 'ex', sats: 60_000_000, proceedsCents: plan.proceedsCents, picks: plan.picks, spent: false };
      const trial = trialReplay(entries, st, [sell]);
      expect(trial.problems).toEqual([]);
      expect(computeEffect(sell, trial.before, trial.after).taxCents).toBe(plan.totalTaxCents);
    }
  });
});
