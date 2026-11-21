/** Losses from past years are kept per tax year (Decision 21); traced coins add back exactly. Synthetic data. */
import { describe, expect, test } from 'vitest';
import { taxContext } from '../src/planner/context.ts';
import { replay } from '../src/replay.ts';
import { carryforwardFor } from '../src/tax/settings.ts';
import { taxForYear } from '../src/tax/tax.ts';
import { traceCoins } from '../src/trace.ts';
import type { Entry, Settings, SettingsPatch } from '../src/types.ts';
import { parseEntry } from '../src/validate.ts';
import { buy, cents, give, lost, move, noon, pick, sats, sell, TZ, wallet } from './helpers.ts';

const settings = (id: string, date: string, patch: SettingsPatch): Entry => ({ id, kind: 'settings', at: noon(date), tz: TZ, patch });

describe('losses from past years, per year', () => {
  const year2025 = (s: Settings) => taxForYear({ year: 2025, filingStatus: 'single', wages: s.wagesCents, st: 0, lt: -cents('5000'), carryforward: carryforwardFor(s, 2025, 2026), state: { customRate: 0 } });

  test('saving next year’s losses (the old single-year way, as Tax season does) leaves the closed year alone', () => {
    const first = replay([settings('s1', '2025-02-01', { filingStatus: 'single', wagesCents: cents('80000'), carryforwardLtCents: cents('10000'), carryforwardYear: 2025 })]).settings;
    const out = year2025(first).carryforwardOut;
    expect(out.lt).toBe(cents('12000')); // 10,000 in + 5,000 loss − 3,000 used
    const after = replay([
      settings('s1', '2025-02-01', { filingStatus: 'single', wagesCents: cents('80000'), carryforwardLtCents: cents('10000'), carryforwardYear: 2025 }),
      settings('s2', '2026-01-10', { carryforwardStCents: out.st, carryforwardLtCents: out.lt, carryforwardYear: 2026 }),
    ]).settings;
    expect(carryforwardFor(after, 2025, 2026)).toEqual({ st: 0, lt: cents('10000') });
    expect(year2025(after).carryforwardOut).toEqual(out);
    expect(carryforwardFor(after, 2026)).toEqual(out);
    expect(carryforwardFor(after, 2027)).toEqual({ st: 0, lt: 0 });
    expect(after.carryforwardByYear).toEqual({ '2025': { st: 0, lt: cents('10000') }, '2026': out });
  });

  test('per-year patches write only the years they name; amounts without a year go to the year already saved', () => {
    const s = replay([
      settings('s1', '2025-02-01', { carryforwardByYear: { '2025': { st: 1, lt: 2 }, '2026': { st: 3, lt: 4 } } }),
      settings('s2', '2025-03-01', { carryforwardByYear: { '2026': { st: 5, lt: 6 } } }),
      settings('s3', '2025-04-01', { carryforwardYear: 2024 }),
      settings('s4', '2025-05-01', { carryforwardLtCents: 9 }),
    ]).settings;
    expect(s.carryforwardByYear).toEqual({ '2024': { st: 0, lt: 9 }, '2025': { st: 1, lt: 2 }, '2026': { st: 5, lt: 6 } });
  });

  test('old entries without a year apply to the year they were saved in, for Tax season and the planners alike', () => {
    const state = replay([wallet('ex'), settings('s1', '2026-02-01', { carryforwardLtCents: cents('10000') })]);
    expect(state.settings.carryforwardYear).toBe(2026);
    for (const year of [2024, 2026, 2027]) expect(taxContext(state, state.settings, year, `${year}-12-31`).carryforward).toEqual(carryforwardFor(state.settings, year, 2030));
    expect(taxContext(state, state.settings, 2026, '2026-12-31').carryforward).toEqual({ st: 0, lt: cents('10000') });
    expect(taxContext(state, state.settings, 2024, '2024-12-31').carryforward).toEqual({ st: 0, lt: 0 });
  });

  test('settings built by hand without per-year figures use the single-year fields', () => {
    expect(carryforwardFor({ carryforwardStCents: 1, carryforwardLtCents: 2 }, 2025)).toEqual({ st: 1, lt: 2 });
    expect(carryforwardFor({ carryforwardStCents: 1, carryforwardLtCents: 2, carryforwardByYear: {} }, 2025, 2026)).toEqual({ st: 0, lt: 0 });
  });

  test('per-year figures are validated', () => {
    const ok = (patch: unknown): boolean => parseEntry({ id: 'x', kind: 'settings', at: '2025-01-01T00:00:00Z', tz: TZ, patch }).ok;
    expect(ok({ carryforwardByYear: { '2025': { st: 0, lt: 1 } } })).toBe(true);
    expect(ok({ carryforwardByYear: { '25': { st: 0, lt: 1 } } })).toBe(false);
    expect(ok({ carryforwardByYear: { '1969': { st: 0, lt: 1 } } })).toBe(false);
    expect(ok({ carryforwardByYear: { '2025': { st: -1, lt: 1 } } })).toBe(false);
    expect(ok({ carryforwardByYear: { '2025': { st: 0 } } })).toBe(false);
    expect(ok({ carryforwardByYear: [] })).toBe(false);
  });
});

describe('traced coins add back exactly', () => {
  test('two purchases through moves with fees, a sale across both, gifts, losses and a close-out', () => {
    const entries: Entry[] = [
      wallet('ex'),
      wallet('cold', 'self-custody'),
      wallet('bad'),
      buy('A', 'ex', '2024-01-10', '0.33333333', '10000.01'),
      buy('B', 'ex', '2024-01-11', '0.66666667', '20000.02'),
      move('M1', 'ex', 'cold', '2024-02-01', sats('0.3'), 1_111, '0.37', [pick('A', '0.2'), pick('B', '0.10001111')]),
      move('M2', 'cold', 'bad', '2024-02-02', sats('0.15'), 7, '0.01', [pick('M1:A', '0.1'), pick('M1:B', '0.05000007')]),
      sell('S', 'bad', '2024-03-01', [pick('M2:M1:A', '0.05'), pick('M2:M1:B', '0.03')], '3333.33'),
      give('G', 'cold', '2024-03-02', [pick('M1:A', '0.01'), pick('M1:B', '0.01')], '777.77', 'charity', 'Church'),
      lost('L', 'ex', '2024-03-03', [pick('A', '0.00000001'), pick('B', '0.00000002')]),
      { id: 'F', kind: 'wallet-freeze', at: noon('2024-04-01'), tz: TZ, wallet: 'bad' },
      { id: 'C', kind: 'wallet-close-out', at: noon('2024-05-01'), tz: TZ, wallet: 'bad', reason: 'failed' },
    ];
    const state = replay(entries);
    expect(state.errors).toEqual([]);
    const a = traceCoins(state, ['A']);
    const b = traceCoins(state, ['B']);
    const goneSats = (t: typeof a): number => t.gone.reduce((s, g) => s + g.sats, 0);
    const goneCost = (t: typeof a): number => t.gone.reduce((s, g) => s + g.costCents, 0);
    expect(a.heldSats + a.frozenSats + goneSats(a)).toBe(sats('0.33333333'));
    expect(b.heldSats + b.frozenSats + goneSats(b)).toBe(sats('0.66666667'));
    expect(a.heldCostCents + a.frozenCostCents + goneCost(a)).toBe(cents('10000.01'));
    expect(b.heldCostCents + b.frozenCostCents + goneCost(b)).toBe(cents('20000.02'));
    expect([...a.gone, ...b.gone].filter((g) => g.kind === 'sold').reduce((s, g) => s + g.proceedsCents, 0)).toBe(cents('3333.33'));
    expect([...a.gone, ...b.gone].filter((g) => g.kind === 'fees').every((g) => g.proceedsCents === 0)).toBe(true);
    expect(a.gone.every((g) => !b.gone.some((h) => h.entryId === g.entryId && h.lotId === g.lotId))).toBe(true);
  });
});
