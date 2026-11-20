/** Money correctness and hostile amounts (from an adversarial review). Synthetic data only. */
import { describe, expect, test } from 'vitest';
import { newBook } from '../src/book.ts';
import { applyEntry } from '../src/handlers.ts';
import { exportOpeningLotsCsv } from '../src/io.ts';
import { divRoundHalfUp, MAX_ENTRY_CENTS, MAX_ENTRY_SATS, mulDivOrNull } from '../src/money.ts';
import { replay } from '../src/replay.ts';
import { averageCostPerBtc, holdings } from '../src/reports.ts';
import type { Entry, LedgerState } from '../src/types.ts';
import { buy, cents, edit, errorCodes, move, noon, pick, receive, sats, sell, testBook, TZ, wallet } from './helpers.ts';

const del = (id: string, target: string): Entry => ({ id, kind: 'delete', at: noon('2026-06-01'), tz: TZ, replaces: target, reason: 'r' });
const totalSats = (s: LedgerState): number => s.lots.reduce((a, l) => a + l.sats, 0);

describe('editing an entry keeps its lots (lot id = root of the version chain)', () => {
  test('fixing the cost typo of a partly sold buy keeps the sale, with the corrected cost', () => {
    const b = buy('B', 'ex', '2025-01-10', '1', '50000');
    const s = sell('S', 'ex', '2026-03-01', [pick('B', '0.4')], '30000');
    const fix = edit(b, { id: 'B-fix', reason: 'typo in cost', costCents: cents('50100') });
    const state = replay([wallet('ex'), b, s, fix]);
    expect(state.errors).toEqual([]);
    expect(state.disposals.map((d) => [d.entryId, d.costCents])).toEqual([['S', cents('20040')]]);
    expect(totalSats(state)).toBe(sats('0.6'));
  });
  test('fixing the fee value of a move keeps the sale of the moved coins (pieces stay M:<lot>)', () => {
    const entries: Entry[] = [wallet('cold', 'self-custody'), wallet('ex'), buy('B', 'cold', '2024-01-10', '1', '40000')];
    const m = move('M', 'cold', 'ex', '2026-01-05', sats('0.5'), 1000, '1.00', [pick('B', '0.50001')]);
    const s = sell('S', 'ex', '2026-02-01', [{ lotId: 'M:B', sats: sats('0.5') }], '40000');
    const fix = edit(m, { id: 'M-fix', reason: 'fee value typo', feeValueCents: 95 });
    const state = replay([...entries, m, s, fix]);
    expect(errorCodes(state)).toEqual({});
    expect(state.disposals.map((d) => [d.kind, d.entryId, d.proceedsCents])).toEqual([['fee', 'M-fix', 95], ['sell', 'S', cents('40000')]]);
  });
  test('deleting then restoring a buy (replacing the delete) keeps the sale', () => {
    const b = buy('B', 'ex', '2025-01-10', '1', '50000');
    const s = sell('S', 'ex', '2026-03-01', [pick('B', '0.4')], '30000');
    const restore = { ...b, id: 'R', replaces: 'D', reason: 'deleted by mistake' } as Entry;
    const state = replay([wallet('ex'), b, s, del('D', 'B'), restore]);
    expect(state.errors).toEqual([]);
    expect(state.disposals.map((x) => x.entryId)).toEqual(['S']);
  });
});

describe('lot ids never collide', () => {
  test('an entry id "<moveId>:<lot>" is rejected, so the move piece cannot overwrite it', () => {
    const entries: Entry[] = [
      wallet('ex'), wallet('cold', 'self-custody'),
      buy('M:B', 'ex', '2024-01-01', '1', '10000'),
      buy('B', 'cold', '2024-02-01', '2', '30000'),
      move('M', 'cold', 'ex', '2025-01-01', sats('2'), 0, '0', [pick('B', '2')]),
    ];
    const state = replay(entries);
    expect(errorCodes(state)).toEqual({ 'M:B': 'invalid-entry' });
    expect(totalSats(state)).toBe(sats('2'));
    expect(state.lots.reduce((a, l) => a + l.costCents, 0)).toBe(cents('30000'));
  });
  test('defensively, a lot id already in use is refused (handlers called directly, past validation)', () => {
    const book = newBook(replay([]), new Map());
    const at = (e: Entry): ReturnType<typeof applyEntry> => applyEntry(book, e, '2024-01-01');
    expect(at(wallet('ex'))).toBeNull();
    expect(at(wallet('cold'))).toBeNull();
    expect(at(buy('B', 'ex', '2024-01-01', '1', '1'))).toBeNull();
    expect(at(buy('B', 'ex', '2024-01-01', '1', '1'))).toMatchObject({ code: 'duplicate-lot' });
    expect(at(receive('B', 'ex', '2024-01-01', '1', '1', { type: 'income' }))).toMatchObject({ code: 'duplicate-lot' });
    expect(book.state.income).toEqual([]);
    expect(at(buy('M:B', 'cold', '2024-01-01', '1', '1'))).toBeNull();
    expect(at(move('M', 'ex', 'cold', '2024-01-01', sats('1'), 0, '0', [pick('B', '1')]))).toMatchObject({ code: 'duplicate-lot', message: 'lot M:B already exists' });
    expect(book.lots.get('B')?.sats).toBe(sats('1'));
  });
});

describe('no throws on user-caused values', () => {
  test('a 1-sat lot entered with a $1,000,000 cost: average cost is null ("—"), export leaves cost_per_btc empty', () => {
    const state = replay([wallet('ex'), { id: 'B', kind: 'buy', at: noon('2025-01-01'), tz: TZ, wallet: 'ex', sats: 1, costCents: cents('1000000'), tier: 'documented' }]);
    expect(holdings(state)).toMatchObject({ totalSats: 1, averageCostCentsPerBtc: null });
    expect(exportOpeningLotsCsv(state).csv.split('\n')[1]).toBe('ex,2025-01-01 19:00:00,0.00000001,1,1000000.00,,Documented,Email receipt,America/Boise');
    expect(averageCostPerBtc(0, 0)).toBeNull();
    expect(mulDivOrNull(Number.MAX_SAFE_INTEGER, 2, 1)).toBeNull();
  });
  test('more than 21M BTC or $1 trillion in one entry is rejected as invalid', () => {
    const big = (id: string, s: number, c: number): Entry => ({ id, kind: 'buy', at: noon('2025-01-01'), tz: TZ, wallet: 'ex', sats: s, costCents: c, tier: 'documented' });
    const state = replay([wallet('ex'), big('B1', MAX_ENTRY_SATS + 1, 1), big('B2', 1, MAX_ENTRY_CENTS + 1)]);
    expect(errorCodes(state)).toEqual({ B1: 'invalid-entry', B2: 'invalid-entry' });
    expect(holdings(state).totalSats).toBe(0);
  });
  test('an entry that would push the ledger totals out of exact range is an out-of-range error', () => {
    const buys = Array.from({ length: 46 }, (_, i) => ({ id: `B${i}`, kind: 'buy', at: noon('2025-01-01'), tz: TZ, wallet: 'ex', sats: 1, costCents: MAX_ENTRY_CENTS, tier: 'documented' }) as Entry);
    const state = replay([wallet('ex'), ...buys]);
    expect(errorCodes(state)).toEqual({ B9: 'out-of-range' }); // ids sort B0, B1, B10.. B19, B2, ...: B9 is the 46th
    expect(Number.isSafeInteger(holdings(state).moneyPutInCents)).toBe(true);
    const whales = Array.from({ length: 3 }, (_, i) => ({ id: `W${i}`, kind: 'buy', at: noon('2025-01-01'), tz: TZ, wallet: 'ex', sats: MAX_ENTRY_SATS, costCents: 1, tier: 'documented' }) as Entry);
    expect(errorCodes(replay([wallet('ex'), ...whales]))).toEqual({ W2: 'out-of-range' });
    const paid = Array.from({ length: 46 }, (_, i) => ({ id: `G${String(i).padStart(2, '0')}`, kind: 'giving-paid', at: noon('2025-01-01'), tz: TZ, year: 2025, cents: MAX_ENTRY_CENTS }) as Entry);
    expect(errorCodes(replay(paid))).toEqual({ G45: 'out-of-range' });
  });
});

describe('conservation (regression guards)', () => {
  test('move with fee: moved cost + fee cost + remaining cost = original cost', () => {
    const entries: Entry[] = [...testBook(), wallet('cold', 'self-custody'), move('M', 'ex', 'cold', '2026-11-15', sats('0.6'), 2000, '1.50', [pick('L1', '0.5'), pick('L2', '0.10002')])];
    const s = replay(entries);
    const fee = s.disposals.reduce((a, d) => a + d.costCents, 0);
    expect(s.lots.reduce((a, l) => a + l.costCents, 0) + fee).toBe(cents('65300'));
    expect(totalSats(s) + 2000).toBe(sats('1.2'));
  });
});

describe('rounding', () => {
  test('halves round away from zero, symmetric for negatives (documented in the spec)', () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1n);
    expect(divRoundHalfUp(-4n, 10n)).toBe(0n);
  });
});
