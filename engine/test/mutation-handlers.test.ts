/**
 * Targeted tests added from mutation testing (`npm run mutate`) for handlers.ts and trace.ts: each pins down
 * behavior a surviving mutant changed. Exact values, no snapshots.
 */
import { describe, expect, test } from 'vitest';
import { applySettingsPatch } from '../src/handlers.ts';
import { DEFAULT_SETTINGS, replay } from '../src/replay.ts';
import { traceCoins } from '../src/trace.ts';
import type { Entry } from '../src/types.ts';
import { buy, cents, give, lost, move, noon, pick, receive, sats, sell, TZ, wallet } from './helpers.ts';

const freeze = (id: string, w: string, date: string): Entry => ({ id, kind: 'wallet-freeze', at: noon(date), tz: TZ, wallet: w });
const closeOut = (id: string, w: string, date: string, lossDate?: string): Entry => ({ id, kind: 'wallet-close-out', at: noon(date), tz: TZ, wallet: w, reason: 'plan', ...(lossDate === undefined ? {} : { lossDate }) });
const payout = (id: string, to: string, from: string, date: string, btc: string, dollars: string): Entry => receive(id, to, date, btc, dollars, { type: 'frozen-payout', fromWallet: from });
const confirm = (id: string, w: string, date: string, s: number): Entry => ({ id, kind: 'balance-confirm', at: noon(date), tz: TZ, wallet: w, sats: s });

describe('lots created by each entry kind', () => {
  test('an opening lot is not inherited: a sale within a year is short-term', () => {
    const state = replay([
      wallet('ex'),
      { id: 'O', kind: 'opening-lot', at: noon('2025-06-01'), tz: TZ, wallet: 'ex', acquiredAt: noon('2025-01-01'), sats: sats('1'), costCents: cents('1000'), tier: 'estimated', origin: 'old note' },
      sell('S', 'ex', '2025-06-02', [pick('O', '1')], '1500'),
    ]);
    expect(state.errors).toEqual([]);
    expect(state.disposals[0]?.picks[0]).toMatchObject({ term: 'short', inherited: false, gainCents: cents('500') });
  });
  const MAX = 100_000_000_000_000; // largest cents one entry may carry ($1 trillion)
  const pad = (i: number): string => `E${String(i).padStart(3, '0')}`;
  test('a buy refused for pushing the ledger past its total makes no lot', () => {
    // 2^52 cents is the ledger cap: 45 buys of $1 trillion fit, the 46th does not.
    const buys = Array.from({ length: 46 }, (_, i) => buy(pad(i), 'ex', '2025-01-01', '0.00000001', '1'));
    const state = replay([wallet('ex'), ...buys.map((b) => ({ ...b, costCents: MAX }))]);
    expect(state.errors.map((e) => [e.entryId, e.code])).toEqual([[pad(45), 'out-of-range']]);
    expect(state.lots).toHaveLength(45);
  });
  test('a gift receive adds its value and the giver\'s cost to the ledger total (a difference would never hit the cap)', () => {
    // each gift counts 2 trillion dollars of volume: 22 fit under 2^52 cents, the 23rd does not
    const gifts: Entry[] = Array.from({ length: 23 }, (_, i) => ({ ...receive(pad(i), 'ex', '2025-01-01', '0.00000001', '1', { type: 'gift', giverCostCents: MAX }), valueCents: MAX }));
    const state = replay([wallet('ex'), ...gifts]);
    expect(state.errors.map((e) => [e.entryId, e.code])).toEqual([[pad(22), 'out-of-range']]);
  });
  test('an income receive is not a gift: its lot cost is its value and it is not in gifts received', () => {
    const state = replay([wallet('ex'), receive('I', 'ex', '2025-01-01', '0.1', '5000', { type: 'income' })]);
    expect(state.lots[0]).toMatchObject({ costCents: cents('5000'), tier: 'documented', alwaysLongTerm: false, lossBasis: null });
    expect(state.giftsReceived).toEqual([]);
    expect(state.cpaFlags).toEqual([]);
  });
});

describe('moves', () => {
  test('a pick that is entirely fee creates no destination lot', () => {
    const state = replay([
      wallet('ex'), wallet('cold', 'self-custody'),
      buy('L1', 'ex', '2025-01-02', '1', '100'),
      buy('L2', 'ex', '2025-01-03', '1', '100'),
      // moves all of L1; the fee comes entirely from L2
      move('M', 'ex', 'cold', '2025-02-01', sats('1'), 1000, '1', [pick('L1', '1'), { lotId: 'L2', sats: 1000 }]),
    ]);
    expect(state.errors).toEqual([]);
    expect(state.lots.filter((l) => l.wallet === 'cold').map((l) => [l.id, l.sats])).toEqual([['M:L1', sats('1')]]);
    expect(state.lots.map((l) => l.id)).not.toContain('M:L2');
    expect(state.lots.find((l) => l.id === 'L2')?.sats).toBe(sats('1') - 1000);
  });
  test('a move reaches both wallets\' "since last match" lists', () => {
    const state = replay([
      wallet('ex'), wallet('cold', 'self-custody'),
      buy('B', 'ex', '2025-01-01', '1', '100'),
      move('M', 'ex', 'cold', '2025-02-01', sats('0.5'), 0, '0', [pick('B', '0.5')]),
      confirm('C1', 'ex', '2025-03-01', 1),
      confirm('C2', 'cold', '2025-03-01', 1),
    ]);
    expect(state.balanceChecks.find((c) => c.entryId === 'C1')?.entriesSinceLastMatch).toEqual(['B', 'M']);
    expect(state.balanceChecks.find((c) => c.entryId === 'C2')?.entriesSinceLastMatch).toEqual(['M']);
  });
  test('a sell touches its wallet', () => {
    const state = replay([wallet('ex'), buy('B', 'ex', '2025-01-01', '1', '100'), sell('S', 'ex', '2025-02-01', [pick('B', '0.5')], '60'), confirm('C', 'ex', '2025-03-01', 0)]);
    expect(state.balanceChecks[0]).toMatchObject({ matches: false, ledgerSats: sats('0.5'), differenceSats: -sats('0.5'), entriesSinceLastMatch: ['B', 'S'] });
  });
});

describe('balance confirmations', () => {
  test('a wallet nothing touched has an empty since-list', () => {
    const state = replay([wallet('ex'), confirm('C', 'ex', '2025-03-01', 5)]);
    expect(state.balanceChecks[0]).toMatchObject({ matches: false, differenceSats: 5, entriesSinceLastMatch: [] });
  });
  test('only a match resets the list: two mismatches in a row both list what came before', () => {
    const state = replay([
      wallet('ex'), buy('B', 'ex', '2025-01-01', '1', '100'),
      confirm('C1', 'ex', '2025-02-01', 7), confirm('C2', 'ex', '2025-02-02', 8),
      confirm('C3', 'ex', '2025-02-03', sats('1')), confirm('C4', 'ex', '2025-02-04', 9),
    ]);
    const byId = Object.fromEntries(state.balanceChecks.map((c) => [c.entryId, [c.matches, c.entriesSinceLastMatch]]));
    expect(byId).toEqual({ C1: [false, ['B']], C2: [false, ['B']], C3: [true, []], C4: [false, []] });
  });
});

describe('close-out', () => {
  const frozen = (extra: Entry[]): Entry[] => [wallet('ex'), wallet('lend'), ...extra];
  test('a close-out touches the closed wallet', () => {
    const state = replay(frozen([buy('B', 'lend', '2024-01-01', '1', '100'), freeze('F', 'lend', '2024-02-01'), closeOut('X', 'lend', '2024-03-01'), confirm('C', 'lend', '2024-04-01', 3)]));
    expect(state.balanceChecks[0]?.entriesSinceLastMatch).toEqual(['B', 'X']);
  });
  test('equal short and long weights recover as long-term; one more short sat makes it short', () => {
    // No cost: weights by sats. 1 short (bought 2024-06) and 1 long (bought 2022) sat → tie → long.
    const mk = (shortSats: string): Entry[] => frozen([
      buy('B1', 'lend', '2022-01-01', '0.00000001', '0'), buy('B2', 'lend', '2024-06-01', shortSats, '0'),
      freeze('F', 'lend', '2024-07-01'), closeOut('X', 'lend', '2024-08-01'), payout('P', 'ex', 'lend', '2024-09-01', '0.00000001', '10'),
    ]);
    expect(replay(mk('0.00000001')).closeOuts[0]?.recoveryTerm).toBe('long');
    expect(replay(mk('0.00000002')).closeOuts[0]?.recoveryTerm).toBe('short');
  });
  test('recovered dollars split by cost when any lot has cost, by sats when none', () => {
    // One free lot (0 cost) and one costed lot: a split by cost gives everything to the costed lot.
    const state = replay(frozen([buy('B1', 'lend', '2024-01-01', '1', '0'), buy('B2', 'lend', '2024-01-02', '1', '100'), freeze('F', 'lend', '2024-02-01'), closeOut('X', 'lend', '2024-03-01'), payout('P', 'ex', 'lend', '2024-02-15', '0.5', '40')]));
    const c = state.closeOuts[0];
    expect(c?.pieces.map((p) => [p.lotId, p.recoveredCents])).toEqual([['B1', 0], ['B2', cents('40')]]);
  });
  test('payouts from another frozen wallet do not reduce this wallet\'s loss', () => {
    const state = replay([
      wallet('ex'), wallet('a'), wallet('b'),
      buy('A1', 'a', '2024-01-01', '1', '100'), buy('B1', 'b', '2024-01-01', '1', '100'),
      freeze('FA', 'a', '2024-02-01'), freeze('FB', 'b', '2024-02-01'),
      closeOut('XA', 'a', '2024-03-01'), closeOut('XB', 'b', '2024-03-01'),
      payout('PA', 'ex', 'a', '2024-02-15', '0.1', '30'), payout('PB', 'ex', 'b', '2024-02-16', '0.1', '20'),
    ]);
    expect(Object.fromEntries(state.wallets.map((w) => [w.id, w.recoveredCents]))).toMatchObject({ a: cents('30'), b: cents('20') });
    expect(state.closeOuts.map((c) => [c.wallet, c.recoveredCents])).toEqual([['a', cents('30')], ['b', cents('20')]]);
  });
  test('only payouts after the loss date are recoveries, and each goes to its own close-out', () => {
    const state = replay([
      wallet('ex'), wallet('a'), wallet('b'),
      buy('A1', 'a', '2024-01-01', '1', '100'), buy('B1', 'b', '2024-01-01', '1', '100'),
      freeze('FA', 'a', '2024-02-01'), freeze('FB', 'b', '2024-02-01'),
      closeOut('XA', 'a', '2024-03-01'), closeOut('XB', 'b', '2024-03-01'),
      payout('PA', 'ex', 'a', '2024-05-01', '0.1', '30'), payout('PB', 'ex', 'b', '2024-05-02', '0.1', '20'),
    ]);
    expect(state.recoveries.map((r) => [r.entryId, r.closeOutEntryId, r.gainCents])).toEqual([['PA', 'XA', cents('30')], ['PB', 'XB', cents('20')]]);
  });
});

describe('trace coins', () => {
  test('gone pieces are in date order across kinds, and recoveries need a closed-out piece among them', () => {
    const state = replay([
      wallet('ex'),
      buy('B', 'ex', '2020-01-01', '1', '1000'),
      give('G', 'ex', '2024-01-01', [pick('B', '0.1')], '500', 'person', 'Sam'),
      lost('L', 'ex', '2023-01-01', [pick('B', '0.1')]),
      sell('S', 'ex', '2025-01-01', [pick('B', '0.1')], '900'),
    ]);
    const t = traceCoins(state, ['B']);
    expect(t.gone.map((g) => [g.kind, g.entryId, g.date])).toEqual([['lost', 'L', '2023-01-01'], ['given', 'G', '2024-01-01'], ['sold', 'S', '2025-01-01']]);
    expect(t.recovered).toEqual([]);
  });
  test('recoveries are traced when coins were partly sold and partly closed out; free lots split by sats, costed by cost', () => {
    const state = replay([
      wallet('ex'), wallet('lend'),
      buy('B1', 'lend', '2024-01-01', '1', '0'), buy('B2', 'lend', '2024-01-02', '1', '100'),
      sell('S', 'lend', '2024-01-10', [pick('B2', '0.5')], '60'),
      freeze('F', 'lend', '2024-02-01'), closeOut('X', 'lend', '2024-03-01'), payout('P', 'ex', 'lend', '2024-06-01', '0.1', '30'),
    ]);
    const t = traceCoins(state, ['B1', 'B2']);
    expect(t.gone.map((g) => g.kind).sort()).toEqual(['closed-out', 'closed-out', 'sold']);
    // pieces: B1 (cost 0), B2 remainder (cost 50): split by cost, all to B2
    expect(t.recovered.map((r) => [r.lotId, r.cents])).toEqual([['B1', 0], ['B2', cents('30')]]);
    // tracing only the free lot gets none of the recovery
    expect(traceCoins(state, ['B1']).recovered.map((r) => r.cents)).toEqual([0]);
  });
  test('a trace of coins never closed out ignores other coins\' recoveries', () => {
    const state = replay([
      wallet('ex'), wallet('lend'),
      buy('B1', 'lend', '2024-01-01', '1', '100'), buy('K', 'ex', '2024-01-01', '1', '100'),
      freeze('F', 'lend', '2024-02-01'), closeOut('X', 'lend', '2024-03-01'), payout('P', 'ex', 'lend', '2024-06-01', '0.1', '30'),
    ]);
    expect(traceCoins(state, ['K']).recovered).toEqual([]);
    expect(traceCoins(state, ['B1']).recovered.map((r) => r.cents)).toEqual([cents('30')]);
  });
});

describe('wallet names and retired giving records', () => {
  test('a taken-name problem quotes the trimmed name', () => {
    const state = replay([wallet('a', 'exchange', 'Main'), wallet('b', 'exchange', '  Main  ')]);
    expect(state.errors).toEqual([{ entryId: 'w-b', code: 'wallet-name-taken', message: 'another wallet is already named "Main"' }]);
  });
  test('giving-paid entries (a retired feature) are accepted and ignored, whatever their size', () => {
    const gp = (i: number): Entry => ({ id: `G${String(i).padStart(3, '0')}`, kind: 'giving-paid', at: noon('2025-01-01'), tz: TZ, year: 2025, cents: 100_000_000_000_000 });
    const state = replay(Array.from({ length: 46 }, (_, i) => gp(i)));
    expect(state.errors).toEqual([]);
    expect(state.applied).toHaveLength(46);
  });
});

describe('settings patches', () => {
  const s = { ...DEFAULT_SETTINGS, carryforwardStCents: 5, carryforwardLtCents: 7 };
  test('a patch with no carryforward fields leaves the by-year table alone', () => {
    const next = applySettingsPatch({ ...s, carryforwardYear: 2024, carryforwardByYear: { '2024': { st: 1, lt: 2 } } }, { wagesCents: 9 }, 2025);
    expect(next.wagesCents).toBe(9);
    expect(next.carryforwardByYear).toEqual({ '2024': { st: 1, lt: 2 } });
    expect(next.carryforwardYear).toBe(2024);
  });
  test('any one carryforward field writes its year, defaulting to the saved year and then the entry year', () => {
    expect(applySettingsPatch(s, { carryforwardStCents: 11 }, 2025)).toMatchObject({ carryforwardYear: 2025, carryforwardByYear: { '2025': { st: 11, lt: 7 } } });
    expect(applySettingsPatch(s, { carryforwardLtCents: 13 }, 2025)).toMatchObject({ carryforwardYear: 2025, carryforwardByYear: { '2025': { st: 5, lt: 13 } } });
    expect(applySettingsPatch(s, { carryforwardYear: 2022 }, 2025)).toMatchObject({ carryforwardYear: 2022, carryforwardByYear: { '2022': { st: 5, lt: 7 } } });
    expect(applySettingsPatch({ ...s, carryforwardYear: 2023 }, { carryforwardLtCents: 1 }, 2025)).toMatchObject({ carryforwardYear: 2023, carryforwardByYear: { '2023': { st: 5, lt: 1 } } });
  });
});
