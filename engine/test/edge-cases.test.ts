/**
 * Edge cases from the second adversarial review: closed-year bypasses, lot identity across edit chains,
 * dual basis through splits and moves, CSV round trips. Ids compare in creation order:
 * "a…" (before the close) < "k-close" < "m…" (after the close). Synthetic data only.
 */
import { describe, expect, test } from 'vitest';
import { exportOpeningLotsCsv, importOpeningLotsCsv } from '../src/io.ts';
import { lowestTaxOrder } from '../src/picks.ts';
import { replay } from '../src/replay.ts';
import { yearSummary } from '../src/reports.ts';
import type { Entry, OpeningLotEntry } from '../src/types.ts';
import { buy, cents, edit, move, noon, pick, receive, sats, sell, TZ, wallet } from './helpers.ts';

const closeYear = (id: string, year: number): Entry => ({ id, kind: 'close-year', at: noon(`${year + 1}-01-15`), tz: TZ, year });
const del = (id: string, target: string): Entry => ({ id, kind: 'delete', at: noon('2026-03-01'), tz: TZ, replaces: target, reason: 'x' });
const W = { ...wallet('ex'), id: 'a-w' } as Entry;
const COLD = { ...wallet('cold', 'self-custody'), id: 'a-wcold' } as Entry;
const CLOSE = closeYear('k-close', 2025);
const y2025 = (entries: Entry[]): { st: number; lt: number; n: number; closeOutGain: number } => {
  const s = replay(entries);
  const y = yearSummary(s, 2025);
  return { st: y.stGainCents, lt: y.ltGainCents, n: y.disposals.length, closeOutGain: s.closeOuts.reduce((a, c) => a + c.gainCents, 0) };
};

describe('closed-year bypasses', () => {
  // X (2025 buy) has two versions written before the close: an edit A and a delete D. That is a conflict,
  // so X applies. After the close, deleting D (a delete, so "exempt") resolves the conflict to A,
  // changing the closed year's sale.
  const X = buy('a-x', 'ex', '2025-01-10', '1', '40000');
  const A = edit(X, { id: 'a-xa', reason: 'typo', costCents: cents('10000') });
  const D = del('a-xd', 'a-x');
  const S = sell('a-s', 'ex', '2025-06-01', [pick('a-x', '0.5')], '50000');
  const base = [W, X, A, D, S, CLOSE];

  test('baseline: conflict, X applies, 2025 gain $30,000 short', () => {
    expect(replay(base).conflicts.length).toBe(1);
    expect(y2025(base).st).toBe(cents('30000'));
  });
  test('deleting a delete after the close must not change the closed year', () => {
    const dd = del('m-dd', 'a-xd');
    const after = [...base, dd];
    expect(y2025(after)).toEqual(y2025(base));
  });
  test('replacing a delete with an exempt kind (settings) after the close must not change the closed year', () => {
    const s: Entry = { id: 'm-set', kind: 'settings', at: noon('2026-03-01'), tz: TZ, patch: { wagesCents: 1 }, replaces: 'a-xd', reason: 'x' };
    expect(y2025([...base, s])).toEqual(y2025(base));
  });

  // A new opening lot is exempt, but dated before a closed-year close-out it joins the closed-out coins.
  test('a new opening lot (exempt) dated in a closed year must not change that year\'s close-out loss', () => {
    const entries: Entry[] = [
      W,
      buy('a-b', 'ex', '2025-01-10', '1', '40000'),
      { id: 'a-f', kind: 'wallet-freeze', at: noon('2025-03-01'), tz: TZ, wallet: 'ex' },
      { id: 'a-co', kind: 'wallet-close-out', at: noon('2025-06-01'), tz: TZ, wallet: 'ex', reason: 'platform failed' },
      CLOSE,
    ];
    const ol: OpeningLotEntry = { id: 'm-ol', kind: 'opening-lot', at: noon('2025-02-01'), tz: TZ, wallet: 'ex', acquiredAt: noon('2025-02-01'), sats: sats('1'), costCents: cents('100000'), tier: 'estimated', origin: 'sheet' };
    expect(y2025(entries).closeOutGain).toBe(cents('-40000'));
    expect(y2025([...entries, ol]).closeOutGain).toBe(cents('-40000'));
  });
});

describe('lot identity across edit chains', () => {
  const X = buy('a-x', 'ex', '2026-01-10', '1', '40000');
  test('edit chain of length 4: lot keeps the root id, cost from the newest', () => {
    const x2 = edit(X, { id: 'b2', reason: 'r', costCents: cents('41000') });
    const x3 = edit(x2, { id: 'b3', reason: 'r', costCents: cents('42000') });
    const x4 = edit(x3, { id: 'b4', reason: 'r', costCents: cents('43000') });
    const s = sell('c-s', 'ex', '2026-06-01', [pick('a-x', '0.5')], '30000');
    const st = replay([W, X, x2, x3, x4, s]);
    expect(st.errors).toEqual([]);
    expect(st.disposals[0]?.costCents).toBe(cents('21500'));
    expect(st.lots.map((l) => [l.id, l.originEntryId])).toEqual([['a-x', 'b4']]);
  });
  test('delete, restore, edit: lot keeps the root id', () => {
    const d = del('b1', 'a-x');
    const restore = { ...X, id: 'b2', replaces: 'b1', reason: 'restore' } as Entry;
    const x3 = { ...X, id: 'b3', replaces: 'b2', reason: 'r', costCents: cents('50000') } as Entry;
    const s = sell('c-s', 'ex', '2026-06-01', [pick('a-x', '0.5')], '30000');
    const st = replay([W, X, d, restore, x3, s]);
    expect(st.errors).toEqual([]);
    expect(st.disposals[0]?.costCents).toBe(cents('25000'));
  });
  test('editing a move whose piece was moved again keeps the downstream move and sale working', () => {
    const M = move('a-m', 'ex', 'cold', '2026-02-01', sats('0.6'), 0, '0', [pick('a-x', '0.6')]);
    const N = move('a-n', 'cold', 'ex', '2026-03-01', sats('0.6'), 0, '0', [pick('a-m:a-x', '0.6')]);
    const S = sell('a-s', 'ex', '2026-06-01', [pick('a-n:a-m:a-x', '0.6')], '30000');
    const m2 = edit(M, { id: 'b-m2', reason: 'fee was missing', sats: sats('0.6'), feeSats: 1000, feeValueCents: 50, picks: [pick('a-x', '0.60001')] });
    const m3 = edit(m2, { id: 'b-m3', reason: 'later time', at: noon('2026-02-02') });
    const st = replay([W, COLD, X, M, N, S, m2, m3]);
    expect(st.errors).toEqual([]);
    expect(st.disposals.map((d) => [d.entryId, d.kind])).toEqual([['b-m3', 'fee'], ['a-s', 'sell']]);
    expect(st.disposals[1]?.costCents).toBe(cents('24000'));
  });
  test('conflict resolved by deleting one version: lot id is the root', () => {
    const a = edit(X, { id: 'b-a', reason: 'r', costCents: cents('1') });
    const b = edit(X, { id: 'b-b', reason: 'r', costCents: cents('2') });
    const s = sell('c-s', 'ex', '2026-06-01', [pick('a-x', '1')], '30000');
    const st = replay([W, X, a, b, del('c-db', 'b-b'), s]);
    expect(st.errors).toEqual([]);
    expect(st.disposals[0]?.costCents).toBe(cents('1'));
  });
});

describe('dual basis through split, move, fee, and sales in each region', () => {
  // Giver's cost $10,000 (2020-01-01), value at gift $6,000 (2026-01-10), 1 BTC.
  const G = receive('a-g', 'ex', '2026-01-10', '1', '6000', { type: 'gift', giverCostCents: cents('10000'), giverAcquiredAt: noon('2020-01-01') });
  const M = move('a-m', 'ex', 'cold', '2026-02-01', sats('0.5'), 1000, '0.05', [pick('a-g', '0.50001')]);
  const M2 = move('a-m2', 'cold', 'ex', '2026-02-15', sats('0.3'), 0, '0', [pick('a-m:a-g', '0.3')]);
  const gain = sell('a-s1', 'ex', '2026-03-01', [pick('a-m2:a-m:a-g', '0.1')], '1500');
  const mid = sell('a-s2', 'ex', '2026-03-02', [pick('a-m2:a-m:a-g', '0.1')], '800');
  const loss = sell('a-s3', 'ex', '2026-03-03', [pick('a-m2:a-m:a-g', '0.1')], '500');
  const st = replay([W, COLD, G, M, M2, gain, mid, loss]);
  test('no errors', () => expect(st.errors).toEqual([]));
  test('fee from a dual-basis lot: proceeds 5c below loss basis 6c → 1c short loss from the gift date', () => {
    const fee = st.disposals.find((d) => d.kind === 'fee');
    expect(fee?.picks[0]).toMatchObject({ costCents: 6, gainCents: -1, term: 'short', acquiredDate: '2026-01-10' });
  });
  test('gain region, middle region, loss region', () => {
    const byId = Object.fromEntries(st.disposals.map((d) => [d.entryId, d]));
    expect(byId['a-s1']).toMatchObject({ costCents: cents('1000'), ltGainCents: cents('500'), stGainCents: 0 });
    expect(byId['a-s2']).toMatchObject({ costCents: cents('800'), gainCents: 0 });
    expect(byId['a-s3']).toMatchObject({ costCents: cents('600'), stGainCents: cents('-100'), ltGainCents: 0 });
  });
  test('remaining lots carry both bases, adding back to the original', () => {
    const lots = Object.fromEntries(st.lots.map((l) => [l.id, l]));
    expect(lots['a-g']).toMatchObject({ sats: sats('0.49999'), costCents: cents('10000') - cents('5000') - 10, lossBasis: { costCents: cents('6000') - cents('3000') - 6 } });
    expect(lots['a-m:a-g']).toMatchObject({ sats: sats('0.2'), costCents: cents('2000'), lossBasis: { costCents: cents('1200'), acquiredDate: '2026-01-10' } });
    expect(st.lots.find((l) => l.id === 'a-m2:a-m:a-g')).toBeUndefined();
  });
});

describe('opening-lots CSV round trip with neutralized cells', () => {
  test('an origin that starts with an apostrophe and "=" survives export → import', () => {
    const ol: OpeningLotEntry = { id: 'a-ol', kind: 'opening-lot', at: noon('2020-01-01'), tz: TZ, wallet: 'ex', acquiredAt: noon('2020-01-01'), sats: 1000, costCents: 100, tier: 'documented', origin: "'=from sheet" };
    const state = replay([W, ol]);
    const back = importOpeningLotsCsv(exportOpeningLotsCsv(state).csv, { wallets: state.wallets, tz: TZ, newId: () => 'n1' });
    expect(back.ok && back.value.entries[0]?.origin).toBe("'=from sheet");
  });
  test('a wallet named with a leading apostrophe and "-" still matches on import', () => {
    const w = { ...wallet('odd', 'exchange', "'-Odd"), id: 'a-wodd' } as Entry;
    const ol: OpeningLotEntry = { id: 'a-ol', kind: 'opening-lot', at: noon('2020-01-01'), tz: TZ, wallet: 'odd', acquiredAt: noon('2020-01-01'), sats: 1000, costCents: 100, tier: 'documented', origin: 'x' };
    const state = replay([w, ol]);
    const back = importOpeningLotsCsv(exportOpeningLotsCsv(state).csv, { wallets: state.wallets, tz: TZ, newId: () => 'n1' });
    expect(back.ok).toBe(true);
  });
  test('ordinary formula-looking text round-trips', () => {
    const w = { ...wallet('f', 'exchange', '=Coinbase'), id: 'a-wf' } as Entry;
    const ol: OpeningLotEntry = { id: 'a-ol', kind: 'opening-lot', at: noon('2020-01-01'), tz: TZ, wallet: 'f', acquiredAt: noon('2020-01-01'), sats: 1000, costCents: 100, tier: 'documented', origin: '+1 note' };
    const state = replay([w, ol]);
    const back = importOpeningLotsCsv(exportOpeningLotsCsv(state).csv, { wallets: state.wallets, tz: TZ, newId: () => 'n1' });
    expect(back.ok && back.value.entries[0]).toMatchObject({ wallet: 'f', origin: '+1 note' });
  });
});

describe('closed years: opening lots and later freezes or close-outs', () => {
  const freeze: Entry = { id: 'a-f', kind: 'wallet-freeze', at: noon('2025-03-01'), tz: TZ, wallet: 'ex' };
  const ol = (id: string, date: string): OpeningLotEntry => ({ id, kind: 'opening-lot', at: noon(date), tz: TZ, wallet: 'ex', acquiredAt: noon(date), sats: 1000, costCents: 1, tier: 'estimated', origin: 'sheet' });
  test('refused before a closed-year freeze in its wallet; allowed after it is unlocked; other wallets unaffected', () => {
    const entries = [W, COLD, buy('a-b', 'ex', '2025-01-10', '1', '40000'), freeze, CLOSE];
    expect(replay([...entries, ol('m-ol', '2025-02-01')]).errors.map((e) => [e.entryId, e.code])).toEqual([['m-ol', 'closed-year']]);
    const unlock: Entry = { id: 'l-unlock', kind: 'unlock-year', at: noon('2026-02-01'), tz: TZ, year: 2025, reason: 'adding records' };
    expect(replay([...entries, unlock, ol('m-ol', '2025-02-01')]).errors).toEqual([]);
    expect(replay([...entries, { ...ol('m-cold', '2025-02-01'), wallet: 'cold' }]).errors).toEqual([]);
  });
});

describe('move pieces are keyed by source lot', () => {
  const X = buy('a-x', 'ex', '2026-01-10', '1', '40000');
  const Y = buy('a-y', 'ex', '2026-01-11', '1', '20000');
  test('nested moves give nested ids; a move cannot pick the same lot twice', () => {
    const M1 = move('m1', 'ex', 'cold', '2026-02-01', sats('0.5'), 0, '0', [pick('a-x', '0.5')]);
    const M2 = move('m2', 'cold', 'ex', '2026-03-01', sats('0.5'), 0, '0', [pick('m1:a-x', '0.5')]);
    const twice = move('m3', 'ex', 'cold', '2026-04-01', sats('0.2'), 0, '0', [pick('a-y', '0.1'), pick('a-y', '0.1')]);
    const st = replay([W, COLD, X, Y, M1, M2, twice]);
    expect(st.errors.map((e) => [e.entryId, e.code])).toEqual([['m3', 'duplicate-pick']]);
    expect(st.lots.map((l) => l.id)).toEqual(['a-x', 'a-y', 'm2:m1:a-x']);
  });
  test('an edit that reorders picks keeps which lot a later sale refers to', () => {
    const M = move('m', 'ex', 'cold', '2026-02-01', sats('0.3'), 0, '0', [pick('a-x', '0.1'), pick('a-y', '0.2')]);
    const S = sell('s', 'cold', '2026-03-01', [pick('m:a-y', '0.2')], '30000');
    const reordered = edit(M, { id: 'n', reason: 'order', picks: [pick('a-y', '0.2'), pick('a-x', '0.1')] });
    const st = replay([W, COLD, X, Y, M, S, reordered]);
    expect(st.errors).toEqual([]);
    expect(st.disposals[0]?.costCents).toBe(cents('4000'));
  });
});

describe('lowest-tax order uses the basis that applies at the price (dual basis)', () => {
  const G = receive('g', 'ex', '2026-01-10', '1', '6000', { type: 'gift', giverCostCents: cents('10000'), giverAcquiredAt: noon('2020-01-01') });
  const order = (others: Entry[], price: string, onDate = '2026-06-01'): string[] =>
    lowestTaxOrder(replay([W, G, ...others]).lots, 'ex', { priceCents: cents(price), onDate, stRate: 1, ltRate: 1 }).map((l) => l.id);
  test('below the value at the gift: loss from that value, not from the giver cost', () => {
    expect(order([buy('b', 'ex', '2026-01-11', '1', '8000')], '5000')).toEqual(['b', 'g']);
    // A year after the gift the $1,000 loss is long-term (20%: −$200), ranking ahead of a $500 short-term loss (30%: −$150).
    const lots = replay([W, G, buy('b', 'ex', '2027-01-11', '1', '5500')]).lots;
    expect(lowestTaxOrder(lots, 'ex', { priceCents: cents('5000'), onDate: '2027-06-01', stRate: 0.3, ltRate: 0.2 }).map((l) => l.id)).toEqual(['g', 'b']);
  });
  test('between value and cost: no gain or loss', () => {
    expect(order([buy('b', 'ex', '2026-01-11', '1', '7900')], '8000')).toEqual(['g', 'b']);
  });
  test("above the giver's cost: gain from the giver's cost", () => {
    expect(order([buy('b', 'ex', '2026-01-11', '1', '11000')], '12000')).toEqual(['b', 'g']);
  });
});
