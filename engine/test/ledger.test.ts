/** Replay rules: wallets, lots, disposals, receives, frozen platforms, balance checks, settings. */
import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS, replay } from '../src/replay.ts';
import type { Entry } from '../src/types.ts';
import { buy, cents, errorCodes, give, lost, move, noon, pick, receive, sats, sell, testBook, TZ, wallet } from './helpers.ts';

const freeze = (id: string, w: string, date: string): Entry => ({ id, kind: 'wallet-freeze', at: noon(date), tz: TZ, wallet: w });
const closeOut = (id: string, w: string, date: string, lossDate?: string): Entry => ({ id, kind: 'wallet-close-out', at: noon(date), tz: TZ, wallet: w, reason: 'Plan effective', ...(lossDate === undefined ? {} : { lossDate }) });
const confirm = (id: string, w: string, date: string, s: number): Entry => ({ id, kind: 'balance-confirm', at: noon(date), tz: TZ, wallet: w, sats: s });
const snapshot = (id: string, w: string, date: string, s: number): Entry => ({ id, kind: 'retirement-snapshot', at: noon(date), tz: TZ, wallet: w, sats: s });

describe('replay basics', () => {
  test('empty ledger', () => {
    const state = replay([]);
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
    expect(state.settings.timeZone).toBe('America/Boise');
    expect(state.wallets).toEqual([]);
  });
  test('order is at, then id, whatever the input order', () => {
    const entries = [...testBook(), sell('S', 'ex', '2026-01-01', [pick('L1', '0.1')], '7000'), { ...sell('S0', 'ex', '2026-01-01', [pick('L1', '0.4')], '1'), at: noon('2026-01-01') }];
    const a = replay(entries);
    const b = replay([...entries].reverse());
    expect(b).toEqual(a);
    expect(a.disposals.map((d) => d.entryId)).toEqual(['S', 'S0']);
  });
  test('wallets exist for the whole timeline: a wallet created today holds an older buy', () => {
    const state = replay([{ ...wallet('ex'), at: '2026-11-20T00:00:00Z' }, buy('B', 'ex', '2021-01-01', '0.1', '1')]);
    expect(state.errors).toEqual([]);
    expect(state.applied).toEqual(['w-ex', 'B']);
  });
  test('an entry that fails leaves everything else applied', () => {
    const state = replay([...testBook(), sell('S', 'ex', '2026-01-01', [pick('L1', '0.6')], '1'), sell('T', 'ex', '2026-01-02', [pick('L1', '0.5')], '1')]);
    expect(errorCodes(state)).toEqual({ S: 'insufficient-sats' });
    expect(state.disposals.map((d) => d.entryId)).toEqual(['T']);
    expect(state.applied).not.toContain('S');
  });
  test('ledger output is a copy: changing it does not change a later replay', () => {
    const entries = testBook();
    const first = replay(entries);
    (first.lots[0] as { sats: number }).sats = 1;
    expect(replay(entries).lots[0]?.sats).toBe(sats('0.5'));
  });
});

describe('wallets', () => {
  test('create, rename, archive, unarchive; duplicate ids rejected', () => {
    const state = replay([
      wallet('ex', 'exchange', 'Coinbase'),
      { ...wallet('ex'), id: 'x-dup' },
      { id: 'u1', kind: 'wallet-update', at: noon('2020-01-01'), tz: TZ, wallet: 'ex', name: 'CB', archived: true },
      { id: 'u2', kind: 'wallet-update', at: noon('2020-01-02'), tz: TZ, wallet: 'ex', archived: false },
      { id: 'u3', kind: 'wallet-update', at: noon('2020-01-03'), tz: TZ, wallet: 'nope', name: 'x' },
    ]);
    expect(errorCodes(state)).toEqual({ 'x-dup': 'wallet-exists', u3: 'unknown-wallet' });
    expect(state.wallets).toEqual([{ id: 'ex', name: 'CB', type: 'exchange', defaultProof: 'Email receipt', archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0 }]);
  });
  test('a disposal can only use lots in its own wallet (Rev. Proc. 2024-28)', () => {
    const state = replay([...testBook(), wallet('cold', 'self-custody'), sell('S', 'cold', '2026-01-01', [pick('L1', '0.1')], '1')]);
    expect(errorCodes(state)).toEqual({ S: 'wrong-wallet' });
  });
  test('entries for unknown wallets are rejected', () => {
    const state = replay([
      buy('B', 'nope', '2024-01-01', '1', '1'),
      sell('S', 'nope', '2024-01-02', [pick('B', '1')], '1'),
      receive('R', 'nope', '2024-01-02', '1', '1', { type: 'income' }),
      { id: 'O', kind: 'opening-lot', at: noon('2020-01-01'), tz: TZ, wallet: 'nope', acquiredAt: noon('2020-01-01'), sats: 1, costCents: 1, tier: 'unknown', origin: '' },
    ]);
    expect(errorCodes(state)).toEqual({ B: 'unknown-wallet', S: 'unknown-wallet', R: 'unknown-wallet', O: 'unknown-wallet' });
  });
  test('rename only keeps the archived flag', () => {
    const state = replay([wallet('ex'), { id: 'u', kind: 'wallet-update', at: noon('2020-01-01'), tz: TZ, wallet: 'ex', name: 'Renamed' }]);
    expect(state.wallets[0]).toMatchObject({ name: 'Renamed', archived: false });
  });
  test('frozen wallets keep lots but take no new coins and allow no disposals', () => {
    const state = replay([
      ...testBook(),
      wallet('cold', 'self-custody'),
      freeze('F', 'ex', '2026-01-01'),
      buy('B', 'ex', '2026-02-01', '0.1', '1'),
      sell('S', 'ex', '2026-02-01', [pick('L1', '0.1')], '1', true),
      move('M', 'ex', 'cold', '2026-02-01', sats('0.1'), 0, '0', [pick('L1', '0.1')]),
      buy('C', 'cold', '2026-02-01', '0.1', '1'),
      move('M2', 'cold', 'ex', '2026-02-02', sats('0.1'), 0, '0', [pick('C', '0.1')]),
      lost('X', 'ex', '2026-02-03', [pick('L1', '0.1')]),
      give('G', 'ex', '2026-02-03', [pick('L1', '0.1')], '1', 'person', 'Sam'),
    ]);
    expect(errorCodes(state)).toEqual({ B: 'wallet-frozen', S: 'wallet-frozen', M: 'wallet-frozen', M2: 'wallet-frozen', X: 'wallet-frozen', G: 'wallet-frozen' });
    expect(state.lots.filter((l) => l.wallet === 'ex')).toHaveLength(4);
    expect(state.wallets.map((w) => [w.id, w.frozen])).toEqual([['cold', false], ['ex', true]]);
  });
  test('freezing an unknown or retirement wallet is rejected', () => {
    const state = replay([wallet('ira', 'retirement'), freeze('F1', 'ira', '2026-01-01'), freeze('F2', 'nope', '2026-01-01')]);
    expect(errorCodes(state)).toEqual({ F1: 'retirement-wallet', F2: 'unknown-wallet' });
  });
  test('retirement wallets hold snapshots only', () => {
    const state = replay([
      wallet('ira', 'retirement'),
      wallet('ex'),
      buy('B', 'ira', '2024-01-01', '1', '1'),
      snapshot('R1', 'ira', '2026-01-01', sats('0.3')),
      snapshot('R2', 'ex', '2026-01-01', 1),
      snapshot('R3', 'nope', '2026-01-01', 1),
      confirm('C', 'ira', '2026-01-01', 1),
    ]);
    expect(errorCodes(state)).toEqual({ B: 'retirement-wallet', R2: 'not-retirement-wallet', R3: 'unknown-wallet', C: 'retirement-wallet' });
    expect(state.retirementSnapshots).toEqual([{ entryId: 'R1', wallet: 'ira', at: noon('2026-01-01'), date: '2026-01-01', sats: sats('0.3') }]);
    expect(state.lots).toEqual([]);
  });
});

describe('lots', () => {
  test('a buy creates a lot whose id is the entry id; proof defaults to the wallet default', () => {
    const state = replay([wallet('ex'), buy('B1', 'ex', '2024-01-01', '0.1', '4000', 'reconstructed'), { ...buy('B2', 'ex', '2024-01-02', '0.2', '1'), proof: 'Bank statement' }]);
    expect(state.lots).toEqual([
      { id: 'B1', wallet: 'ex', sats: sats('0.1'), costCents: cents('4000'), acquiredDate: '2024-01-01', acquiredAt: noon('2024-01-01'), tier: 'reconstructed', proof: 'Email receipt', originEntryId: 'B1', alwaysLongTerm: false },
      { id: 'B2', wallet: 'ex', sats: sats('0.2'), costCents: 100, acquiredDate: '2024-01-02', acquiredAt: noon('2024-01-02'), tier: 'documented', proof: 'Bank statement', originEntryId: 'B2', alwaysLongTerm: false },
    ]);
    expect(state.buyCostCents).toBe(cents('4001'));
  });
  test('opening lots: origin becomes proof; acquired date comes from acquiredAt', () => {
    const state = replay([wallet('ex'), { id: 'O', kind: 'opening-lot', at: '2023-01-20T14:02:11Z', tz: TZ, wallet: 'ex', acquiredAt: '2023-01-20T05:02:11Z', sats: 5, costCents: 7, tier: 'estimated', origin: 'Old spreadsheet' }]);
    expect(state.lots[0]).toMatchObject({ id: 'O', proof: 'Old spreadsheet', acquiredDate: '2023-01-19', tier: 'estimated' });
    expect(state.buyCostCents).toBe(0);
  });
});

describe('disposals', () => {
  test('pick validation: unknown, duplicate, sum mismatch, insufficient', () => {
    const state = replay([
      ...testBook(),
      sell('S1', 'ex', '2026-01-01', [pick('nope', '0.1')], '1'),
      sell('S2', 'ex', '2026-01-01', [pick('L1', '0.1'), pick('L1', '0.1')], '1'),
      { ...sell('S3', 'ex', '2026-01-01', [pick('L1', '0.1')], '1'), sats: sats('0.2') },
      sell('S4', 'ex', '2026-01-01', [pick('L4', '0.2')], '1'),
    ]);
    expect(errorCodes(state)).toEqual({ S1: 'unknown-lot', S2: 'duplicate-pick', S3: 'picks-sum-mismatch', S4: 'insufficient-sats' });
  });
  test('gifts and losses validate picks too', () => {
    const state = replay([...testBook(), give('G', 'ex', '2026-01-01', [pick('L4', '0.2')], '1', 'person', 'Sam'), lost('X', 'ex', '2026-01-01', [pick('nope', '0.1')])]);
    expect(errorCodes(state)).toEqual({ G: 'insufficient-sats', X: 'unknown-lot' });
    expect(state.lost).toEqual([]);
    expect(state.cpaFlags).toEqual([]);
  });
  test('an emptied lot cannot be used again', () => {
    const state = replay([...testBook(), sell('S1', 'ex', '2026-01-01', [pick('L4', '0.1')], '1'), sell('S2', 'ex', '2026-01-02', [pick('L4', '0.01')], '1')]);
    expect(errorCodes(state)).toEqual({ S2: 'insufficient-sats' });
  });
  test('proceeds split across picks by sats; gains labeled short or long at the sale date', () => {
    const state = replay([...testBook(), sell('S', 'ex', '2026-02-10', [pick('L3', '0.1'), pick('L4', '0.1')], '10000.01')]);
    const d = state.disposals[0];
    // L3 bought 2025-02-10: 2026-02-10 is the anniversary, still short-term.
    expect(d?.picks.map((p) => [p.lotId, p.term, p.proceedsCents, p.costCents])).toEqual([
      ['L3', 'short', 500_001, cents('9750')],
      ['L4', 'short', 500_000, cents('8800')],
    ]);
    expect(d?.proceedsCents).toBe(1_000_001);
    const next = replay([...testBook(), sell('S', 'ex', '2026-02-11', [pick('L3', '0.1')], '1')]);
    expect(next.disposals[0]?.picks[0]?.term).toBe('long');
  });
  test('spending is a disposal labeled spend, allowed from self-custody', () => {
    const state = replay([wallet('cold', 'self-custody'), buy('B', 'cold', '2024-01-01', '0.01', '400'), { ...sell('S', 'cold', '2026-01-01', [pick('B', '0.001')], '90', true), description: 'Pizza' }]);
    expect(state.disposals[0]).toMatchObject({ kind: 'spend', description: 'Pizza', costCents: 4000, gainCents: 5000, wallet: 'cold' });
  });
  test('moves: pieces become new lots in the destination; whole lots get a new id; no fee means no disposal', () => {
    const state = replay([...testBook(), wallet('cold', 'self-custody'), move('M', 'ex', 'cold', '2026-01-01', sats('0.15'), 0, '0', [pick('L4', '0.1'), pick('L3', '0.05')])]);
    expect(state.disposals).toEqual([]);
    expect(state.lots.filter((l) => l.wallet === 'cold').map((l) => [l.id, l.sats, l.costCents, l.acquiredDate, l.originEntryId])).toEqual([
      ['M:0', sats('0.1'), cents('8800'), '2025-12-20', 'L4'],
      ['M:1', sats('0.05'), cents('4875'), '2025-02-10', 'L3'],
    ]);
    expect(state.lots.find((l) => l.id === 'L4')).toBeUndefined();
  });
  test('move fee: moved sats first, then fee sats from the same picks in order', () => {
    // Picks: 0.1 of L4 and 0.0001 of L3; 0.1 moves (all from L4), fee 10,000 sats is from L3.
    const state = replay([...testBook(), wallet('cold'), move('M', 'ex', 'cold', '2026-01-01', sats('0.1'), 10_000, '7.50', [pick('L4', '0.1'), pick('L3', '0.0001')])]);
    expect(state.lots.filter((l) => l.wallet === 'cold').map((l) => l.id)).toEqual(['M:0']);
    expect(state.disposals[0]?.picks.map((p) => [p.lotId, p.sats, p.costCents, p.proceedsCents])).toEqual([['L3', 10_000, 975, 750]]);
  });
  test('move fee spread over two lots splits the fee value by sats', () => {
    const state = replay([...testBook(), wallet('cold'), move('M', 'ex', 'cold', '2026-01-01', 100, 300, '3.00', [{ lotId: 'L1', sats: 200 }, { lotId: 'L2', sats: 200 }])]);
    expect(state.disposals[0]?.picks.map((p) => [p.lotId, p.sats, p.proceedsCents])).toEqual([
      ['L1', 100, 100],
      ['L2', 200, 200],
    ]);
    expect(state.lots.filter((l) => l.wallet === 'cold').map((l) => [l.id, l.sats])).toEqual([['M:0', 100]]);
  });
  test('move needs both wallets usable', () => {
    const state = replay([...testBook(), move('M1', 'nope', 'ex', '2026-01-01', 1, 0, '0', [{ lotId: 'L1', sats: 1 }]), move('M2', 'ex', 'nope', '2026-01-01', 1, 0, '0', [{ lotId: 'L1', sats: 1 }]), move('M3', 'ex', 'nope2', '2026-01-01', 1, 0, '0', [{ lotId: 'L1', sats: 2 }])]);
    expect(errorCodes(state)).toEqual({ M1: 'unknown-wallet', M2: 'unknown-wallet', M3: 'unknown-wallet' });
    const bad = replay([...testBook(), wallet('cold'), move('M', 'ex', 'cold', '2026-01-01', 10, 5, '1', [{ lotId: 'L1', sats: 10 }])]);
    expect(errorCodes(bad)).toEqual({ M: 'picks-sum-mismatch' });
  });
  test('moved coins keep their holding period', () => {
    const state = replay([...testBook(), wallet('cold'), move('M', 'ex', 'cold', '2026-01-01', sats('0.1'), 0, '0', [pick('L1', '0.1')]), sell('S', 'cold', '2026-01-02', [pick('M:0', '0.1')], '7500')]);
    expect(state.disposals[0]).toMatchObject({ ltGainCents: cents('7500') - cents('5600'), stGainCents: 0 });
  });
});

describe('receives', () => {
  test('gift with unknown giver cost: cost 0, dated when received, tier unknown, not income', () => {
    const state = replay([wallet('ex'), receive('G', 'ex', '2026-01-05', '0.01', '900', { type: 'gift' })]);
    expect(state.lots[0]).toMatchObject({ costCents: 0, acquiredDate: '2026-01-05', tier: 'unknown' });
    expect(state.giftsReceived[0]).toMatchObject({ costKnown: false, costCents: 0, valueCents: cents('900'), dualBasis: false });
    expect(state.income).toEqual([]);
  });
  test("gift with giver's cost and date: carried over; below-cost value flags dual basis", () => {
    const g = receive('G', 'ex', '2026-01-05', '0.01', '900', { type: 'gift', giverCostCents: cents('1000'), giverAcquiredAt: noon('2021-12-01') });
    const state = replay([wallet('ex'), g]);
    expect(state.lots[0]).toMatchObject({ costCents: cents('1000'), acquiredDate: '2021-12-01', acquiredAt: noon('2021-12-01'), tier: 'documented' });
    expect(state.giftsReceived[0]).toMatchObject({ dualBasis: true, costKnown: true, acquiredDate: '2021-12-01' });
    expect(state.cpaFlags.map((f) => f.code)).toEqual(['dual-basis']);
    const above = replay([wallet('ex'), { ...g, valueCents: cents('1000'), tier: 'estimated' as const }]);
    expect(above.cpaFlags).toEqual([]);
    expect(above.lots[0]?.tier).toBe('estimated');
  });
  test('inherited coins: cost is the value at death, always long-term', () => {
    const state = replay([wallet('ex'), receive('I', 'ex', '2026-03-01', '0.5', '40000', { type: 'inherited' }), sell('S', 'ex', '2026-03-02', [pick('I', '0.1')], '8000')]);
    expect(state.lots[0]).toMatchObject({ alwaysLongTerm: true, costCents: cents('32000') });
    expect(state.disposals[0]?.picks[0]?.term).toBe('long');
  });
  test('income without a description', () => {
    const state = replay([wallet('ex'), receive('P', 'ex', '2026-01-05', '0.0001', '9', { type: 'income' })]);
    expect(state.income[0]?.description).toBeNull();
  });
  test('frozen payouts need a frozen source wallet', () => {
    const state = replay([wallet('ex'), wallet('lend'), receive('P1', 'ex', '2026-01-05', '0.1', '1', { type: 'frozen-payout', fromWallet: 'lend' }), receive('P2', 'ex', '2026-01-05', '0.1', '1', { type: 'frozen-payout', fromWallet: 'nope' })]);
    expect(errorCodes(state)).toEqual({ P1: 'not-frozen', P2: 'unknown-wallet' });
  });
});

describe('frozen platforms', () => {
  const base: Entry[] = [wallet('ex'), wallet('lend', 'exchange', 'Lender')];
  test('close-out needs a frozen wallet with coins, once', () => {
    const state = replay([
      ...base,
      closeOut('X0', 'nope', '2024-01-01'),
      closeOut('X1', 'lend', '2024-01-01'),
      freeze('F', 'lend', '2024-01-02'),
      closeOut('X2', 'lend', '2024-01-03'),
      buy('B', 'ex', '2023-01-01', '1', '1'),
    ]);
    expect(errorCodes(state)).toEqual({ X0: 'unknown-wallet', X1: 'not-frozen', X2: 'nothing-to-close-out' });
    const twice = replay([...base, buy('B', 'lend', '2023-01-01', '1', '100'), freeze('F', 'lend', '2024-01-02'), closeOut('X1', 'lend', '2024-01-03'), closeOut('X2', 'lend', '2024-01-04')]);
    expect(errorCodes(twice)).toEqual({ X2: 'already-closed-out' });
  });
  test('recovered dollars split across lots by cost; each lot keeps its own holding period at the loss date', () => {
    const state = replay([
      ...base,
      buy('B1', 'lend', '2022-01-01', '0.5', '30000'),
      buy('B2', 'lend', '2023-06-01', '0.5', '10000'),
      freeze('F', 'lend', '2023-07-01'),
      receive('P', 'ex', '2023-08-01', '0.1', '1000.01', { type: 'frozen-payout', fromWallet: 'lend' }),
      closeOut('X', 'lend', '2024-03-01', '2024-01-15'),
    ]);
    const c = state.closeOuts[0];
    expect(c?.pieces.map((p) => [p.lotId, p.term, p.costCents, p.recoveredCents, p.gainCents])).toEqual([
      ['B1', 'long', cents('30000'), 75_001, cents('30000') * -1 + 75_001],
      ['B2', 'short', cents('10000'), 25_000, -cents('10000') + 25_000],
    ]);
    expect(c).toMatchObject({ lossDate: '2024-01-15', year: 2024, recoveredCents: 100_001, gainCents: 100_001 - cents('40000'), recoveryTerm: 'long' });
    expect(state.wallets.find((w) => w.id === 'lend')?.closeOutEntryId).toBe('X');
  });
  test('recovery term is short when the closed lots were mostly short-term by cost (ties are short)', () => {
    const state = replay([...base, buy('B1', 'lend', '2022-01-01', '0.5', '100'), buy('B2', 'lend', '2023-12-01', '0.5', '100'), freeze('F', 'lend', '2024-01-01'), closeOut('X', 'lend', '2024-02-01'), receive('P', 'ex', '2025-01-01', '0.1', '50', { type: 'frozen-payout', fromWallet: 'lend' })]);
    expect(state.closeOuts[0]?.recoveryTerm).toBe('short');
    expect(state.recoveries[0]).toMatchObject({ term: 'short', gainCents: 5000, year: 2025 });
  });
  test('lots with zero cost: recovered dollars split by sats', () => {
    const state = replay([...base, buy('B1', 'lend', '2022-01-01', '0.3', '0'), buy('B2', 'lend', '2022-01-02', '0.1', '0'), freeze('F', 'lend', '2023-01-01'), receive('P', 'ex', '2023-02-01', '0.01', '100', { type: 'frozen-payout', fromWallet: 'lend' }), closeOut('X', 'lend', '2023-03-01')]);
    expect(state.closeOuts[0]?.pieces.map((p) => p.recoveredCents)).toEqual([7500, 2500]);
    expect(state.closeOuts[0]?.ltGainCents).toBe(10_000);
  });
});

describe('balance confirmations', () => {
  test('match → confirmed; mismatch → difference and the entries since the last match', () => {
    const state = replay([
      wallet('ex'),
      wallet('cold'),
      confirm('C0', 'ex', '2024-01-01', 0),
      buy('B1', 'ex', '2024-02-01', '0.1', '1'),
      confirm('C1', 'ex', '2024-03-01', sats('0.1')),
      buy('B2', 'ex', '2024-04-01', '0.1', '1'),
      move('M', 'ex', 'cold', '2024-05-01', 100, 10, '0.01', [{ lotId: 'B2', sats: 110 }]),
      confirm('C2', 'ex', '2024-06-01', sats('0.2')),
      confirm('C3', 'nope', '2024-06-01', 0),
    ]);
    expect(errorCodes(state)).toEqual({ C3: 'unknown-wallet' });
    expect(state.balanceChecks.map((b) => [b.entryId, b.matches, b.differenceSats, b.entriesSinceLastMatch])).toEqual([
      ['C0', true, 0, []],
      ['C1', true, 0, []],
      ['C2', false, 110, ['B2', 'M']],
    ]);
  });
});

describe('gifts, charity, lost, settings, giving', () => {
  test('charity: short-term picks count the lesser of cost and value; small totals need no appraisal', () => {
    const state = replay([
      wallet('ex'),
      buy('B1', 'ex', '2026-01-01', '0.01', '1000'),
      buy('B2', 'ex', '2026-01-02', '0.01', '500'),
      give('G', 'ex', '2026-03-01', [pick('B1', '0.01'), pick('B2', '0.01')], '1600', 'charity', 'Food bank'),
    ]);
    expect(state.charityGifts[0]).toMatchObject({ deductionCents: cents('800') + cents('500'), appraisalFlag: false });
    expect(state.cpaFlags).toEqual([]);
  });
  test('qualified appraisal is flagged when charity gifts in a year total over $5,000', () => {
    const state = replay([
      wallet('ex'),
      buy('B', 'ex', '2020-01-01', '1', '1000'),
      give('G1', 'ex', '2026-03-01', [pick('B', '0.01')], '3000', 'charity', 'A'),
      give('G2', 'ex', '2026-04-01', [pick('B', '0.01')], '2000.01', 'charity', 'B'),
      give('G3', 'ex', '2027-04-01', [pick('B', '0.01')], '5000', 'charity', 'C'),
    ]);
    expect(state.charityGifts.map((g) => g.appraisalFlag)).toEqual([true, true, false]);
    expect(state.cpaFlags.map((f) => f.entryId)).toEqual(['G1', 'G2']);
  });
  test('settings patches merge in order', () => {
    const state = replay([
      { id: 's1', kind: 'settings', at: noon('2026-01-01'), tz: TZ, patch: { wagesCents: 1, givingEnabled: true } },
      { id: 's2', kind: 'settings', at: noon('2026-01-02'), tz: TZ, patch: { wagesCents: 2 } },
    ]);
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, wagesCents: 2, givingEnabled: true });
  });
  test('giving paid is recorded by year', () => {
    const state = replay([{ id: 'g', kind: 'giving-paid', at: noon('2026-01-01'), tz: TZ, year: 2025, cents: 5000 }]);
    expect(state.givingPaid).toEqual([{ entryId: 'g', year: 2025, cents: 5000 }]);
  });
});
