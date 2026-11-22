/** Retirement purchases: replay, validation, edits, holdings, per-purchase views, the all-Bitcoin view and imports. Synthetic data. */
import { describe, expect, test } from 'vitest';
import { exportEntriesJson, exportOpeningLotsCsv, form8949Csv, importEntriesJson, importOpeningLotsCsv } from '../src/io.ts';
import { exampleCoins, exampleLoan } from './loan-helpers.ts';
import { MAX_ENTRY_CENTS, MAX_ENTRY_SATS } from '../src/money.ts';
import { holdings, type RetirementHolding } from '../src/reports.ts';
import { replay } from '../src/replay.ts';
import { allBitcoin, retirementPurchases, retirementWorth, taxableLots, valueOfPieces, worthOf, worthOfPieces } from '../src/retirement.ts';
import type { Entry, RetirementBuyEntry } from '../src/types.ts';
import { parseEntry } from '../src/validate.ts';
import { buy, cents, noon, sats, testBook, TZ, wallet } from './helpers.ts';

const rbuy = (id: string, w: string, date: string, btc: string, dollars: string, extra: Partial<RetirementBuyEntry> = {}): RetirementBuyEntry => ({ id, kind: 'retirement-buy', at: noon(date), tz: TZ, wallet: w, sats: sats(btc), costCents: cents(dollars), ...extra });
const snapshot = (id: string, w: string, date: string, s: number): Entry => ({ id, kind: 'retirement-snapshot', at: noon(date), tz: TZ, wallet: w, sats: s });
const errorCodes = (entries: Entry[]): Record<string, string> => Object.fromEntries(replay(entries).errors.map((e) => [e.entryId, e.code]));
const PRICE = cents('75000');

describe('retirement purchases in replay', () => {
  test('are recorded apart from lots, with the root id and proof', () => {
    const state = replay([wallet('ira', 'retirement'), rbuy('R1', 'ira', '2024-02-01', '0.1', '4000', { proof: 'Statement' }), rbuy('R2', 'ira', '2025-03-01', '0.05', '3000')]);
    expect(state.errors).toEqual([]);
    expect(state.lots).toEqual([]);
    expect(state.retirementBuys).toEqual([
      { entryId: 'R1', id: 'R1', wallet: 'ira', at: noon('2024-02-01'), date: '2024-02-01', tz: TZ, sats: sats('0.1'), costCents: cents('4000'), proof: 'Statement' },
      { entryId: 'R2', id: 'R2', wallet: 'ira', at: noon('2025-03-01'), date: '2025-03-01', tz: TZ, sats: sats('0.05'), costCents: cents('3000'), proof: '' },
    ]);
  });

  test('refused for unknown, non-retirement and (after archiving) archived wallets', () => {
    const archive: Entry = { id: 'A', kind: 'wallet-update', at: noon('2025-01-01'), tz: TZ, wallet: 'ira', archived: true };
    const codes = errorCodes([wallet('ex'), wallet('ira', 'retirement'), archive, rbuy('R1', 'nope', '2024-01-01', '0.1', '1'), rbuy('R2', 'ex', '2024-01-01', '0.1', '1'), rbuy('R3', 'ira', '2024-06-01', '0.1', '1'), rbuy('R4', 'ira', '2025-06-01', '0.1', '1')]);
    expect(codes).toEqual({ R1: 'unknown-wallet', R2: 'not-retirement-wallet', R4: 'wallet-archived' });
  });

  test('a taxable buy into a retirement wallet is still refused', () => {
    const state = replay([wallet('ira', 'retirement'), buy('B', 'ira', '2024-01-01', '0.1', '100')]);
    expect(state.errors.map((e) => [e.entryId, e.code])).toEqual([['B', 'retirement-wallet']]);
    expect(state.errors[0]?.message).toContain('kept apart from tax math');
  });

  test('have their own range budget, so they never refuse a taxable entry', () => {
    const big = (id: string): RetirementBuyEntry => ({ id, kind: 'retirement-buy', at: noon('2024-01-01'), tz: TZ, wallet: 'ira', sats: MAX_ENTRY_SATS, costCents: MAX_ENTRY_CENTS });
    const state = replay([wallet('ira', 'retirement'), wallet('ex'), big('R1'), big('R2'), big('R3'), { ...buy('B', 'ex', '2024-02-01', '1', '1'), sats: MAX_ENTRY_SATS }]);
    expect(state.errors.map((e) => [e.entryId, e.code])).toEqual([['R3', 'out-of-range']]);
    expect(state.lots.map((l) => l.id)).toEqual(['B']);
  });

  test('a balance note after the wallet was archived is refused like a purchase', () => {
    const archive: Entry = { id: 'A', kind: 'wallet-update', at: noon('2025-01-01'), tz: TZ, wallet: 'ira', archived: true };
    const state = replay([wallet('ira', 'retirement'), archive, snapshot('S1', 'ira', '2024-06-01', 5), snapshot('S2', 'ira', '2025-06-01', 7)]);
    expect(state.errors.map((e) => [e.entryId, e.code])).toEqual([['S2', 'wallet-archived']]);
    expect(state.retirementSnapshots.map((x) => x.entryId)).toEqual(['S1']);
  });

  test('a retirement purchase never displaces a taxable entry with the same id', () => {
    const taxable = buy('X', 'ex', '2024-01-01', '1', '30000');
    const state = replay([wallet('ex'), wallet('ira', 'retirement'), taxable, rbuy('X', 'ira', '2024-01-01', '0.1', '1'), { id: 'X', kind: 'loan-draw', at: noon('2024-01-01'), tz: TZ, loan: 'h', cents: 1 }]);
    expect(state.lots.map((l) => l.id)).toEqual(['X']);
    expect(state.retirementBuys).toEqual([]);
    expect(state.errors).toEqual([{ entryId: 'X', code: 'duplicate-id', message: 'a retirement purchase reused the id of a taxable entry; the retirement purchase is ignored' }]);
    // A retirement purchase still wins over a loan record; two taxable entries reject the id.
    const ret = replay([wallet('ira', 'retirement'), rbuy('Y', 'ira', '2024-01-01', '0.1', '1'), { id: 'Y', kind: 'loan-draw', at: noon('2024-01-01'), tz: TZ, loan: 'h', cents: 1 }]);
    expect(ret.retirementBuys.map((b) => b.id)).toEqual(['Y']);
    const two = replay([wallet('ex'), wallet('ira', 'retirement'), taxable, { ...taxable, sats: 5 }, rbuy('X', 'ira', '2024-01-01', '0.1', '1')]);
    expect(two.errors.map((e) => e.code)).toEqual(['duplicate-id']);
    expect(two.lots).toEqual([]);
  });

  test('are exempt from closed years', () => {
    const close: Entry = { id: 'Z', kind: 'close-year', at: noon('2025-01-15'), tz: TZ, year: 2024 };
    const state = replay([wallet('ira', 'retirement'), close, rbuy('zz-late', 'ira', '2024-05-01', '0.1', '100')]);
    expect(state.errors).toEqual([]);
    expect(state.retirementBuys).toHaveLength(1);
  });
});

describe('editing and removing', () => {
  const base = [wallet('ira', 'retirement'), wallet('ex'), rbuy('R1', 'ira', '2024-02-01', '0.1', '4000'), buy('B1', 'ex', '2024-01-01', '1', '30000')];

  test('an edit keeps the root id; a delete removes it', () => {
    const edited = replay([...base, rbuy('R2', 'ira', '2024-02-02', '0.2', '8000', { replaces: 'R1', reason: 'typo' })]);
    expect(edited.retirementBuys.map((b) => [b.entryId, b.id, b.sats])).toEqual([['R2', 'R1', sats('0.2')]]);
    const removed = replay([...base, { id: 'D', kind: 'delete', at: noon('2024-03-01'), tz: TZ, replaces: 'R1', reason: 'not mine' }]);
    expect(removed.retirementBuys).toEqual([]);
  });

  test('a retirement purchase and a taxable entry never replace each other', () => {
    const codes = errorCodes([
      ...base,
      rbuy('X1', 'ira', '2024-01-01', '1', '30000', { replaces: 'B1', reason: 'move it' }),
      { ...buy('X2', 'ex', '2024-02-01', '0.1', '4000'), replaces: 'R1', reason: 'move it' },
    ]);
    expect(codes).toEqual({ X1: 'cannot-replace', X2: 'cannot-replace' });
  });

  test('a retirement wallet with purchases cannot be deleted', () => {
    const codes = errorCodes([...base, { id: 'DW', kind: 'delete', at: noon('2024-03-01'), tz: TZ, replaces: 'w-ira', reason: 'gone' }]);
    expect(codes).toEqual({ DW: 'cannot-replace' });
  });
});

describe('validation and JSON', () => {
  test('fields are checked; unknown fields rejected', () => {
    const ok = rbuy('R', 'ira', '2024-01-01', '0.1', '1', { note: 'n', proof: 'p' });
    expect(parseEntry(ok).ok).toBe(true);
    expect(parseEntry({ ...ok, sats: 0 })).toEqual({ ok: false, error: 'invalid "sats"' });
    expect(parseEntry({ ...ok, costCents: -1 })).toEqual({ ok: false, error: 'invalid "costCents"' });
    expect(parseEntry({ ...ok, tier: 'documented' })).toEqual({ ok: false, error: 'unknown field "tier"' });
    expect(parseEntry({ ...ok, wallet: ' ' })).toEqual({ ok: false, error: 'invalid "wallet"' });
  });

  test('export then import reproduces the entries and every figure', () => {
    const entries = [wallet('ira', 'retirement'), rbuy('R1', 'ira', '2024-02-01', '0.1', '4000', { proof: 'Statement', note: 'IRA' }), rbuy('R2', 'ira', '2024-02-02', '0.2', '8000', { replaces: 'R1', reason: 'typo' })];
    const back = importEntriesJson(exportEntriesJson(entries));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(replay(back.value)).toEqual(replay(entries));
  });
});

describe('holdings', () => {
  test('balance: purchases when any, else the latest note; the note is checked against purchases up to its time', () => {
    const h = holdings(
      replay([
        wallet('a', 'retirement'),
        wallet('b', 'retirement'),
        wallet('c', 'retirement'),
        wallet('d', 'retirement'),
        rbuy('A1', 'a', '2024-01-01', '0.1', '3000'),
        rbuy('A2', 'a', '2024-06-01', '0.2', '9000'),
        snapshot('SA', 'a', '2024-03-01', sats('0.1')),
        rbuy('C1', 'c', '2024-01-01', '0.1', '3000'),
        snapshot('SC', 'c', '2024-02-01', sats('0.15')),
        snapshot('SB', 'b', '2024-02-01', sats('0.5')),
      ]),
    );
    const [a, b, c, d] = h.retirement;
    expect(a).toEqual({ wallet: 'a', name: 'a', archived: false, sats: sats('0.3'), balanceFrom: 'purchases', purchaseCount: 2, purchaseSats: sats('0.3'), costCents: cents('12000'), averageCostCentsPerBtc: cents('40000'), snapshot: { entryId: 'SA', date: '2024-03-01', sats: sats('0.1'), purchasedSats: sats('0.1'), differenceSats: 0, matches: true } });
    expect(b).toMatchObject({ sats: sats('0.5'), balanceFrom: 'snapshot', purchaseCount: 0, costCents: 0, averageCostCentsPerBtc: null });
    expect(c?.snapshot).toMatchObject({ purchasedSats: sats('0.1'), differenceSats: sats('0.05'), matches: false });
    expect(c?.sats).toBe(sats('0.1'));
    expect(d).toMatchObject({ sats: 0, balanceFrom: 'none', snapshot: null });
    // Never in the taxable totals.
    expect(h.totalSats).toBe(0);
    expect(h.totalCostCents).toBe(0);
  });
});

describe('per purchase and all Bitcoin', () => {
  const state = replay([
    ...testBook(),
    wallet('ira', 'retirement'),
    wallet('old', 'retirement'),
    wallet('zero', 'retirement'),
    rbuy('R1', 'ira', '2024-02-01', '0.1', '4000'),
    rbuy('R2', 'ira', '2026-11-15', '0.2', '16000', { proof: 'Statement' }),
    rbuy('R3', 'zero', '2026-12-01', '0.01', '0'),
    snapshot('S', 'old', '2025-12-31', sats('0.5')),
  ]);

  test('worth now, gain, percent to the nearest whole and days held', () => {
    const list = retirementPurchases(state, 'ira', PRICE, '2026-11-15');
    expect(list.map((p) => [p.id, p.valueCents, p.gainCents, p.percent, p.heldDays, p.averageCostCentsPerBtc, p.proof])).toEqual([
      ['R1', cents('7500'), cents('3500'), 88, 1018, cents('40000'), ''],
      ['R2', cents('15000'), cents('-1000'), -6, 0, cents('80000'), 'Statement'],
    ]);
    // All wallets; a later date than today counts as 0 days; a $0 cost has no percent.
    const zero = retirementPurchases(state, null, PRICE, '2026-11-15').find((p) => p.id === 'R3');
    expect(zero).toMatchObject({ heldDays: 0, costCents: 0, gainCents: cents('750'), percent: null });
    expect(retirementPurchases(state, 'ira', null, '2026-11-15')[0]).toMatchObject({ valueCents: null, gainCents: null, percent: null });
  });

  test('taxable is exactly the holdings totals; retirement adds its own; the parts add up', () => {
    const h = holdings(state);
    const all = allBitcoin(state, h, PRICE);
    expect(all.taxable).toEqual(worthOf(h.totalSats, h.totalCostCents, PRICE));
    expect(all.taxable).toEqual(worthOfPieces(taxableLots(state), PRICE));
    expect(all.taxable.sats).toBe(sats('1.2'));
    expect(all.retirement).toEqual({ sats: sats('0.81'), costCents: cents('20000'), valueCents: cents('60750'), gainCents: cents('3250'), percent: 16, unknownCostSats: sats('0.5') });
    expect(all.total.sats).toBe(all.taxable.sats + all.retirement.sats);
    expect(all.total.costCents).toBe(cents('85300'));
    expect(all.total.valueCents).toBe((all.taxable.valueCents as number) + cents('60750'));
    expect(all.total.gainCents).toBe((all.taxable.gainCents as number) + cents('3250'));
    const g = all.total.gainCents as number;
    expect(all.total.percent).toBe(Math.sign(g) * Math.round((Math.abs(g) * 100) / cents('85300')));
    expect(all.total.unknownCostSats).toBe(sats('0.5'));
  });

  test('every worth is lot by lot and purchase by purchase, so the lists add up to the totals', () => {
    // At $100,000 per BTC, 5 sats are worth half a cent: each piece rounds to 1 cent, so 3 pieces are 3 cents (not 2).
    const tiny = replay([
      wallet('ex'),
      wallet('ira', 'retirement'),
      wallet('bad'),
      { ...buy('T1', 'ex', '2024-01-01', '0.00000005', '0'), sats: 5 },
      { ...buy('T2', 'ex', '2024-01-02', '0.00000005', '0'), sats: 5 },
      { ...buy('T3', 'ex', '2024-01-03', '0.00000005', '0'), sats: 5 },
      { ...buy('T4', 'bad', '2024-01-03', '1', '1'), sats: 5 },
      { id: 'FZ', kind: 'wallet-freeze', at: noon('2024-02-01'), tz: TZ, wallet: 'bad' },
      { id: 'R1', kind: 'retirement-buy', at: noon('2024-01-01'), tz: TZ, wallet: 'ira', sats: 5, costCents: 0 },
      { id: 'R2', kind: 'retirement-buy', at: noon('2024-01-02'), tz: TZ, wallet: 'ira', sats: 5, costCents: 0 },
    ]);
    const all = allBitcoin(tiny, holdings(tiny), cents('100000'));
    expect(taxableLots(tiny).map((l) => l.id)).toEqual(['T1', 'T2', 'T3']);
    expect(all.taxable).toMatchObject({ sats: 15, valueCents: 3 });
    expect(all.retirement).toMatchObject({ sats: 10, valueCents: 2, gainCents: 2 });
    expect(all.total.valueCents).toBe(5);
    const ira = holdings(tiny).retirement[0] as RetirementHolding;
    expect(retirementWorth(tiny, ira, cents('100000'))).toEqual(worthOfPieces(retirementPurchases(tiny, 'ira', null, '2026-01-01'), cents('100000')));
    expect(retirementWorth(tiny, { ...ira, balanceFrom: 'snapshot', sats: 15 }, cents('100000'))).toEqual({ sats: 15, costCents: 0, valueCents: 2, gainCents: null, percent: null });
    expect(valueOfPieces([{ sats: 5 }, { sats: 5 }], null)).toBeNull();
    expect(valueOfPieces([], cents('100000'))).toBe(0);
  });

  test('no price: worth and gain are null; notes only: gain is the taxable gain', () => {
    const none = allBitcoin(state, holdings(state), null);
    expect([none.taxable.valueCents, none.retirement.valueCents, none.retirement.gainCents, none.total.valueCents, none.total.gainCents]).toEqual([null, null, null, null, null]);
    const notesState = replay([...testBook(), wallet('old', 'retirement'), snapshot('S', 'old', '2025-12-31', sats('0.5'))]);
    const notesOnly = allBitcoin(notesState, holdings(notesState), PRICE);
    expect(notesOnly.retirement).toMatchObject({ sats: sats('0.5'), costCents: 0, valueCents: cents('37500'), gainCents: null, percent: null });
    expect(notesOnly.total.gainCents).toBe(notesOnly.taxable.gainCents);
  });

  test('worth, gain and percent are null together when a worth cannot be represented', () => {
    const bigState = replay([...testBook(), wallet('ira', 'retirement'), wallet('big', 'retirement'), rbuy('R1', 'ira', '2024-01-01', '0.1', '100'), snapshot('S', 'big', '2025-01-01', MAX_ENTRY_SATS)]);
    const all = allBitcoin(bigState, holdings(bigState), MAX_ENTRY_CENTS);
    expect([all.retirement.valueCents, all.retirement.gainCents, all.retirement.percent]).toEqual([null, null, null]);
    expect([all.total.valueCents, all.total.gainCents, all.total.percent]).toEqual([null, null, null]);
  });

  test('a figure too large to represent is null, never rounded', () => {
    const hugeState = replay([wallet('ira', 'retirement'), { id: 'R', kind: 'retirement-buy', at: noon('2024-01-01'), tz: TZ, wallet: 'ira', sats: MAX_ENTRY_SATS, costCents: 1 }]);
    const huge = allBitcoin(hugeState, holdings(hugeState), MAX_ENTRY_CENTS);
    expect(huge.retirement.valueCents).toBeNull();
    expect(huge.retirement.gainCents).toBeNull();
    expect(huge.total.valueCents).toBeNull();
  });
});

describe('opening-lots CSV import', () => {
  const wallets = replay([wallet('ex', 'exchange', 'Coinbase'), wallet('ira', 'retirement', 'My IRA')]).wallets;
  const HEADER = 'wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin,funded_by';
  let n = 0;
  const newId = (): string => `id-${++n}`;

  test('rows for a retirement wallet (empty tier) become retirement purchases', () => {
    n = 0;
    const text = [HEADER, 'Coinbase,2023-01-20 14:02:11,0.4,40000000,9000,,Documented,Receipt,', 'my ira,2023-02-01 10:00:00,0.1,10000000,"2,000.50",,,Statement,', 'My IRA,2023-03-01 10:00:00,,5000000,1000,,,,'].join('\n');
    const r = importOpeningLotsCsv(text, { wallets, tz: TZ, newId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entries.map((e) => e.wallet)).toEqual(['ex']);
    expect(r.value.retirementBuys).toEqual([
      { id: 'id-2', kind: 'retirement-buy', at: '2023-02-01T10:00:00Z', tz: TZ, wallet: 'ira', sats: 10_000_000, costCents: 200_050, proof: 'Statement' },
      { id: 'id-3', kind: 'retirement-buy', at: '2023-03-01T10:00:00Z', tz: TZ, wallet: 'ira', sats: 5_000_000, costCents: 100_000 },
    ]);
    expect(r.value.links).toEqual([]);
    const state = replay([wallet('ex', 'exchange', 'Coinbase'), wallet('ira', 'retirement', 'My IRA'), ...r.value.entries, ...r.value.retirementBuys]);
    expect(state.errors).toEqual([]);
    expect(state.retirementBuys).toHaveLength(2);
  });

  test('a tier on a retirement row is a row problem (an archived taxable wallet of the same name can never lose its lots)', () => {
    const named = replay([wallet('old', 'exchange', 'Savings'), { id: 'arch', kind: 'wallet-update', at: noon('2024-01-01'), tz: TZ, wallet: 'old', archived: true }, wallet('ira', 'retirement', 'Savings')]).wallets;
    const text = [HEADER, 'Savings,2023-02-01 10:00:00,0.1,10000000,2000,,Documented,,', 'Savings,2023-02-01 10:00:00,0.1,10000000,2000,,,,'].join('\n');
    const r = importOpeningLotsCsv(text, { wallets: named, tz: TZ, newId });
    expect(r).toEqual({ ok: false, error: [{ row: 2, message: 'Savings is a retirement wallet; leave tier empty for retirement purchases' }] });
  });

  test('loan columns on a retirement row are a row problem', () => {
    const text = [`${HEADER},funded_by_id,funded_draw_usd,funded_draw_date`, 'My IRA,2023-02-01 10:00:00,0.1,10000000,2000,,,,HELOC,,,', 'My IRA,2023-02-01 10:00:00,0.1,10000000,2000,,,,,,,2023-02-01'].join('\n');
    const r = importOpeningLotsCsv(text, { wallets, tz: TZ, newId, loans: [{ id: 'h', name: 'HELOC', closed: false }] });
    expect(r).toEqual({
      ok: false,
      error: [
        { row: 2, message: 'My IRA is a retirement wallet; leave the funded_by columns empty' },
        { row: 3, message: 'My IRA is a retirement wallet; leave the funded_by columns empty' },
      ],
    });
  });
});

describe('never in tax output', () => {
  test('adding retirement purchases changes no gain, 8949 row or taxable total', () => {
    const coins: Entry[] = [...testBook(), { id: 'S', kind: 'sell', at: noon('2026-11-15'), tz: TZ, wallet: 'ex', sats: sats('0.25'), proceedsCents: cents('18750'), picks: [{ lotId: 'L1', sats: sats('0.25') }], spent: false }];
    const plain = replay([...coins, wallet('ira', 'retirement')]);
    const withIra = replay([...coins, wallet('ira', 'retirement'), rbuy('R1', 'ira', '2021-01-01', '1', '30000'), rbuy('R2', 'ira', '2026-11-01', '0.5', '40000')]);
    expect(withIra.disposals).toEqual(plain.disposals);
    expect(form8949Csv(withIra, 2026)).toBe(form8949Csv(plain, 2026));
    expect({ ...holdings(withIra), retirement: [] }).toEqual({ ...holdings(plain), retirement: [] });
  });
});

describe('exports carry retirement purchases', () => {
  const book = (): Entry[] => [
    ...exampleCoins(),
    ...exampleLoan(),
    wallet('ira', 'retirement', 'My IRA'),
    wallet('ira2', 'retirement', 'Old IRA'),
    rbuy('IR1', 'ira', '2024-02-01', '0.1', '4000', { proof: 'Statement', note: 'First IRA buy' }),
    rbuy('IR2', 'ira2', '2024-03-01', '0.03', '2000.01', { tz: 'America/New_York' }),
    rbuy('IR3', 'ira', '2025-01-10', '0.02', '1900'),
    rbuy('IR4', 'ira', '2025-01-11', '0.5', '9', { replaces: 'IR3', reason: 'typo' }),
    rbuy('IR5', 'ira', '2025-02-01', '0.07', '6000'),
    { id: 'ID5', kind: 'delete', at: noon('2025-03-01'), tz: TZ, replaces: 'IR5', reason: 'not mine' },
    snapshot('IS1', 'ira', '2025-12-31', sats('0.6')),
    { id: 'iset', kind: 'settings', at: noon('2024-01-01'), tz: TZ, patch: { filingStatus: 'married-joint', wagesCents: cents('130000'), earlierMoneyInCents: cents('500') } },
  ];

  test('entries JSON: export, import, replay gives the same state (retirement purchases, edits, deletes, notes, loans, settings)', () => {
    const entries = book();
    const before = replay(entries);
    expect(before.errors).toEqual([]);
    const back = importEntriesJson(exportEntriesJson(entries));
    if (!back.ok) throw new Error(JSON.stringify(back.error));
    expect(replay(back.value)).toEqual(before);
    expect(replay([...back.value].reverse())).toEqual(before);
  });

  test('opening-lots CSV: retirement rows come after the lots, with no tier and no loan cells; re-import recreates them', () => {
    const state = replay(book());
    const exported = exportOpeningLotsCsv(state);
    expect(exported.warnings).toEqual([]);
    const lines = exported.csv.split(/\r?\n/).filter((l) => l !== '');
    expect(lines.slice(-3)).toEqual([
      'My IRA,2024-02-01 19:00:00,0.10000000,10000000,4000.00,40000.00,,Statement,America/Boise,,,,,',
      'My IRA,2025-01-11 19:00:00,0.50000000,50000000,9.00,18.00,,,America/Boise,,,,,',
      'Old IRA,2024-03-01 19:00:00,0.03000000,3000000,2000.01,66667.00,,,America/New_York,,,,,',
    ]);
    // A fresh book with the same wallets and loan, then the import.
    const fresh = [...book().filter((e) => e.kind === 'wallet'), ...exampleLoan().filter((e) => e.kind !== 'loan-link')];
    const freshState = replay(fresh);
    let n = 0;
    const r = importOpeningLotsCsv(exported.csv, { wallets: freshState.wallets, tz: TZ, newId: () => `n${++n}`, loans: freshState.loans });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const after = replay([...fresh, ...r.value.entries, ...r.value.retirementBuys, ...r.value.links]);
    expect(after.errors).toEqual([]);
    const lotView = (s: typeof state): unknown => s.lots.map((l) => [l.wallet, l.sats, l.costCents, l.acquiredAt, l.tier, l.proof]);
    expect(lotView(after)).toEqual(lotView(state));
    const buyView = (s: typeof state): unknown => s.retirementBuys.map((b) => [b.wallet, b.at, b.date, b.tz, b.sats, b.costCents, b.proof]);
    expect(buyView(after)).toEqual(buyView(state));
    const drawView = (s: typeof state): unknown => s.loans.map((l) => l.draws.map((d) => [d.date, d.cents, d.lotIds.length]));
    expect(drawView(after)).toEqual(drawView(state));
    expect(r.value.links).toHaveLength(4);
  });

  test('without the retirement wallet, a retirement row is a row problem (empty tier), never a taxable lot', () => {
    const exported = exportOpeningLotsCsv(replay([wallet('ira', 'retirement', 'My IRA'), rbuy('R1', 'ira', '2024-02-01', '0.1', '4000')]));
    const r = importOpeningLotsCsv(exported.csv, { wallets: replay([wallet('ex', 'exchange', 'My IRA')]).wallets, tz: TZ, newId: () => 'x' });
    expect(r).toEqual({ ok: false, error: [{ row: 2, message: 'tier "" is not Documented, Reconstructed, Estimated or Unknown' }] });
  });

  test('a cost per BTC too large to represent is left empty', () => {
    const csv = exportOpeningLotsCsv(replay([wallet('ira', 'retirement', 'My IRA'), { id: 'R', kind: 'retirement-buy', at: noon('2024-01-01'), tz: TZ, wallet: 'ira', sats: 1, costCents: MAX_ENTRY_CENTS }])).csv;
    expect(csv.split(/\r?\n/)[1]).toBe('My IRA,2024-01-01 19:00:00,0.00000001,1,1000000000000.00,,,,America/Boise');
  });
});
