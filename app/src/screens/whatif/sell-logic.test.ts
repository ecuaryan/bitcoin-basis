import { replay, type Entry, type SalePlan, type SellEntry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_PRICE_CENTS, DEMO_TODAY, W } from '../../demo/demo-data.ts';
import { computeEffect, trialReplay } from '../log/model.ts';
import { bestPills, defaultSats, documentationNote, lotsUsed, mostCarried, planForWallet, riskPercentFromBp, stepFor, summarize, taxEffectLabel, taxShown, termLabel } from './sell-logic.ts';

const plan = (totalTaxCents: number, st = 0, lt = 0, estimatedShareBp = 0): SalePlan => ({ totalTaxCents, carryforwardOut: { st, lt }, estimatedShareBp }) as unknown as SalePlan;
const words = (parts: ReturnType<typeof summarize>): string => parts.map((p) => (typeof p === 'string' ? p : 'cents' in p ? `$${p.cents}` : p.bold)).join('');

describe('Sell summary', () => {
  it('when both choices lower this year’s tax, compares what each saves, then the losses left', () => {
    // Oldest first saves $346, lowest tax $519: lowest tax saves $173 more this year.
    expect(words(summarize(plan(-34_600, 0, 1_900_000), plan(-51_900, 2_400_000, 0)))).toBe('Lowest tax saves $17300 more this year than oldest first. Lowest tax keeps $500000 more losses for next year. ');
    expect(words(summarize(plan(-51_900), plan(-34_600)))).toBe('Oldest first saves $17300 more this year than lowest tax. ');
    expect(words(summarize(plan(-51_900, 0, 1_900_000), plan(-51_900, 2_400_000, 0)))).toBe('Both choices save the same tax this year. Lowest tax keeps $500000 more losses for next year. ');
    expect(words(summarize(plan(0, 100), plan(0)))).toBe('Neither choice adds tax this year. Oldest first keeps $100 more losses for next year. ');
  });
  it('otherwise compares the tax each adds', () => {
    expect(words(summarize(plan(79_925), plan(-51_900)))).toBe('Lowest tax saves $131825 this year compared with oldest first. ');
    expect(words(summarize(plan(100), plan(200)))).toBe('Oldest first is cheaper by $100 this year. ');
    expect(words(summarize(plan(100), plan(100)))).toBe('Both choices add the same tax: $100. ');
  });
  it('words a negative tax as a saving, like the Log review', () => {
    expect(taxEffectLabel(-51_900)).toEqual({ label: 'Tax this saves', cents: 51_900 });
    expect(taxEffectLabel(79_925)).toEqual({ label: 'Tax this adds', cents: 79_925 });
    expect(taxEffectLabel(0)).toEqual({ label: 'Tax this adds', cents: 0 });
    expect(taxEffectLabel(-5, 'a', 's')).toEqual({ label: 's', cents: 5 });
  });
});

describe('Estimated or Unknown share', () => {
  it('rounds up, so the warning never understates it; only all of it is 100%', () => {
    expect(riskPercentFromBp(1_999)).toBe('20%');
    expect(riskPercentFromBp(50)).toBe('1%');
    expect(riskPercentFromBp(2_000)).toBe('20%');
    expect(riskPercentFromBp(9_901)).toBe('99%');
    expect(riskPercentFromBp(9_999)).toBe('99%');
    expect(riskPercentFromBp(10_000)).toBe('100%');
    expect(riskPercentFromBp(0)).toBe('0%');
    expect(documentationNote(plan(0, 0, 0, 1_999), plan(0, 0, 0, 10))).toBe('Part of the sale uses Estimated or Unknown cost (up to 20%): confirm with your CPA.');
    expect(documentationNote(plan(0), plan(0))).toBe('All coins used are Documented.');
  });
});

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

describe('plan cards', () => {
  it('pill: the plan no other beats (less tax, then more losses left), with words for why', () => {
    expect(bestPills([plan(275_925), plan(1_950)])).toEqual([null, 'Least tax']);
    expect(bestPills([plan(90_675), plan(-79_500, 0, 640_000), plan(-26_500)])).toEqual([null, 'Saves the most', null]);
    // Same tax: the engine prefers more losses left for next year.
    expect(bestPills([plan(0, 100), plan(0)])).toEqual(['Keeps more losses', null]);
    // Two plans tie for best: both get it. All tied: nothing to point at.
    expect(bestPills([plan(500), plan(100), plan(100)])).toEqual([null, 'Least tax', 'Least tax']);
    expect(bestPills([plan(100, 5), plan(100, 5)])).toEqual([null, null]);
    // Beats one on tax and another only on losses left: the losses words.
    expect(bestPills([plan(100, 50), plan(100), plan(300)])).toEqual(['Keeps more losses', null, null]);
  });
  it('losses left stand out only on the one plan that leaves the most', () => {
    expect(mostCarried([plan(0, 100), plan(0)])).toEqual([true, false]);
    expect(mostCarried([plan(0, 100), plan(0, 0, 100)])).toEqual([false, false]);
    expect(mostCarried([plan(0), plan(0)])).toEqual([false, false]);
  });
  it('labels flip with the sign', () => {
    expect(termLabel('Short-term', -1)).toBe('Short-term loss');
    expect(termLabel('Long-term', 0)).toBe('Long-term gain');
    const saves = { totalTaxCents: -79_500, federalTaxCents: -66_000, stateTaxCents: -13_500 } as unknown as SalePlan;
    expect(taxShown(saves)).toEqual({ label: 'Tax this saves', saves: true, cents: 79_500, federal: 66_000, state: 13_500 });
    const adds = { totalTaxCents: 275_925, federalTaxCents: 212_250, stateTaxCents: 63_675 } as unknown as SalePlan;
    expect(taxShown(adds)).toEqual({ label: 'Tax this adds', saves: false, cents: 275_925, federal: 212_250, state: 63_675 });
  });

  it('on the demo book, every plan adds up: federal + state = tax, proceeds − tax = kept, lots = Total = short + long', () => {
    const state = replay(buildDemoBook().entries);
    const year = Number(DEMO_TODAY.slice(0, 4));
    let checked = 0;
    for (const settings of [{ ...state.settings, wagesCents: 12_000_000 }, { ...state.settings, wagesCents: 12_000_000, carryforwardStCents: 300_000, carryforwardLtCents: 500_000 }]) {
      for (const sats of [1_234_567, 25_000_000, 61_880_000]) {
        const r = planForWallet({ ...state, settings }, settings, { wallet: W.strike, sats, priceCents: DEMO_PRICE_CENTS, onDate: DEMO_TODAY, year }).plans;
        if (!r.ok) continue;
        for (const p of [r.value.oldestFirst, r.value.lowestTax]) {
          const shown = taxShown(p);
          expect(shown.federal + shown.state).toBe(shown.cents);
          expect(p.proceedsCents + (shown.saves ? shown.cents : -shown.cents)).toBe(p.afterTaxCents);
          const used = lotsUsed(p);
          expect(used.total.sats).toBe(sats);
          expect(used.rows.reduce((s, x) => s + x.proceedsCents, 0)).toBe(used.total.proceedsCents);
          expect(used.rows.reduce((s, x) => s + x.costCents, 0)).toBe(used.total.costCents);
          expect(used.rows.reduce((s, x) => s + x.gainCents, 0)).toBe(used.total.gainCents);
          expect(used.total.gainCents).toBe(p.stGainCents + p.ltGainCents);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});
