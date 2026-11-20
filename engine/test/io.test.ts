import { describe, expect, test } from 'vitest';
import { exportEntriesJson, exportOpeningLotsCsv, form8949Csv, importEntriesJson, importOpeningLotsCsv, incomeCsv } from '../src/io.ts';
import { replay } from '../src/replay.ts';
import type { Entry, Wallet } from '../src/types.ts';
import { createUuidV7 } from '../src/uuidv7.ts';
import { buy, cents, give, move, noon, pick, receive, sats, sell, testBook, TZ, wallet } from './helpers.ts';

const HEADER = 'wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin';

function ids(): () => string {
  let n = 0;
  return () => `id-${String(++n).padStart(3, '0')}`;
}

function walletsOf(entries: Entry[]): Wallet[] {
  return replay(entries).wallets;
}

describe('opening-lots CSV import', () => {
  const wallets = walletsOf([wallet('ex', 'exchange', 'Coinbase'), wallet('cold', 'self-custody', 'Cold storage')]);

  test('parses rows into opening-lot entries; sats are authoritative; dollars parsed exactly', () => {
    const text = [
      HEADER,
      'Coinbase,2023-01-20 14:02:11,0.40000000,40000000,"9,000.00",22500.00,Documented,"Coinbase export, row 12"',
      ' cold storage ,2021-03-15T19:00:00Z,0.5,50000000,28000,56000,reconstructed,Ledger',
      'Coinbase,2024-05-01 00:00:00,0.1,10000001,0.29,,ESTIMATED,',
      'Coinbase,2024-05-02 00:00:00,,1,1,,Unknown,',
    ].join('\r\n');
    const r = importOpeningLotsCsv(text, { wallets, tz: TZ, newId: ids() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entries[0]).toEqual({ id: 'id-001', kind: 'opening-lot', at: '2023-01-20T14:02:11Z', tz: TZ, wallet: 'ex', acquiredAt: '2023-01-20T14:02:11Z', sats: 40_000_000, costCents: 900_000, tier: 'documented', origin: 'Coinbase export, row 12' });
    expect(r.value.entries.map((e) => [e.wallet, e.sats, e.costCents, e.tier])).toEqual([
      ['ex', 40_000_000, 900_000, 'documented'],
      ['cold', 50_000_000, 2_800_000, 'reconstructed'],
      ['ex', 10_000_001, 29, 'estimated'],
      ['ex', 1, 100, 'unknown'],
    ]);
    expect(r.value.warnings).toEqual([{ row: 4, message: 'btc 0.1 disagrees with sats 10000001; using sats' }]);
    const state = replay([wallet('ex', 'exchange', 'Coinbase'), wallet('cold', 'self-custody', 'Cold storage'), ...r.value.entries]);
    expect(state.errors).toEqual([]);
    expect(state.lots.find((l) => l.id === 'id-001')?.proof).toBe('Coinbase export, row 12');
  });

  test('columns in any order, extra columns ignored', () => {
    const text = 'origin,tier,cost_per_btc,cost_usd,sats,btc,acquired_utc,wallet,notes\nX,Documented,,1.00,5,,2024-01-01 00:00:00,Coinbase,hello\n';
    const r = importOpeningLotsCsv(text, { wallets, tz: TZ, newId: ids() });
    expect(r.ok && r.value.entries[0]?.sats).toBe(5);
  });

  test('every row problem is reported together; nothing is imported', () => {
    const text = [
      HEADER,
      'Nowhere,2023-01-20 14:02:11,,1,1,,Documented,',
      'Coinbase,2023-02-30 00:00:00,,0,abc,,Gold,',
      'Coinbase,yesterday,,1.5,1,,Documented,',
      'Coinbase',
    ].join('\n');
    const r = importOpeningLotsCsv(text, { wallets, tz: TZ, newId: ids() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.map((p) => p.row)).toEqual([2, 3, 3, 3, 3, 4, 4, 5, 5, 5, 5]);
    expect(r.error[0]?.message).toBe('no wallet named "Nowhere"');
  });

  test('ambiguous wallet names, missing columns, empty file, bad CSV', () => {
    const twins = walletsOf([wallet('a', 'exchange', 'Same'), wallet('b', 'exchange', 'same')]);
    const r = importOpeningLotsCsv(`${HEADER}\nSame,2024-01-01 00:00:00,,1,1,,Documented,`, { wallets: twins, tz: TZ, newId: ids() });
    expect(r.ok ? null : r.error[0]?.message).toBe('more than one wallet is named "Same"');
    expect(importOpeningLotsCsv('wallet,sats\n', { wallets, tz: TZ, newId: ids() })).toEqual({ ok: false, error: [{ row: 1, message: 'missing columns: acquired_utc, btc, cost_usd, cost_per_btc, tier, origin' }] });
    expect(importOpeningLotsCsv('', { wallets, tz: TZ, newId: ids() })).toEqual({ ok: false, error: [{ row: 1, message: 'the file is empty' }] });
    expect(importOpeningLotsCsv('"oops', { wallets, tz: TZ, newId: ids() })).toEqual({ ok: false, error: [{ row: 0, message: 'a quoted field is not closed' }] });
  });
});

describe('opening-lots CSV export', () => {
  test('exports open lots by wallet then oldest first; import reproduces sats, cost, dates and tiers', () => {
    const entries: Entry[] = [
      ...testBook(),
      wallet('cold', 'self-custody', 'Cold, "deep" storage'),
      move('M', 'ex', 'cold', '2026-01-01', sats('0.1'), 0, '0', [pick('L2', '0.1')]),
      sell('S', 'ex', '2026-01-02', [{ lotId: 'L1', sats: 33_333_333 }], '1'),
      receive('I', 'ex', '2026-02-01', '0.01', '700', { type: 'inherited' }),
    ];
    const state = replay(entries);
    const out = exportOpeningLotsCsv(state);
    // Wallets in creation order ("w-cold" sorts before "w-ex" at the same instant), then oldest first.
    expect(out.csv.split('\n').slice(0, 4)).toEqual([
      HEADER,
      '"Cold, ""deep"" storage",2023-01-20 19:00:00,0.10000000,10000000,2250.00,22500.00,Documented,Email receipt',
      'ex,2021-03-15 19:00:00,0.16666667,16666667,9333.33,55999.98,Documented,Email receipt',
      'ex,2023-01-20 19:00:00,0.30000000,30000000,6750.00,22500.00,Documented,Email receipt',
    ]);
    expect(out.warnings).toEqual(['Lot I is inherited (always long-term); the CSV cannot record that.']);
    const wallets = state.wallets;
    const back = importOpeningLotsCsv(out.csv, { wallets, tz: TZ, newId: createUuidV7({ now: () => 1_700_000_000_000 }) });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const fresh = replay([...entries.filter((e) => e.kind === 'wallet'), ...back.value.entries]);
    const key = (s: typeof state): string[] => s.lots.map((l) => `${l.wallet}|${l.sats}|${l.costCents}|${l.acquiredDate}|${l.tier}|${l.proof}`).sort();
    expect(key(fresh)).toEqual(key(state));
  });
});

describe('entries JSON', () => {
  const entries: Entry[] = [
    ...testBook(),
    sell('S', 'ex', '2026-11-15', [pick('L1', '0.25')], '18750'),
    { id: 'D', kind: 'delete', at: noon('2026-11-16'), tz: TZ, replaces: 'L4', reason: 'duplicate' },
    { id: 'set', kind: 'settings', at: noon('2026-01-01'), tz: TZ, patch: { state: { kind: 'custom', rate: 0.053 } } },
  ];
  test('export then import reproduces every number', () => {
    const text = exportEntriesJson(entries);
    const back = importEntriesJson(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(replay(back.value)).toEqual(replay(entries));
    expect(back.value.map((e) => e.id)).toEqual([...entries.map((e) => e.id)].sort());
  });
  test('rejects non-JSON, other files, other versions and invalid entries', () => {
    expect(importEntriesJson('{')).toEqual({ ok: false, error: [{ index: null, message: 'not valid JSON' }] });
    expect(importEntriesJson('null')).toEqual({ ok: false, error: [{ index: null, message: 'not a Bitcoin Basis entries file' }] });
    expect(importEntriesJson('[]').ok).toBe(false);
    expect(importEntriesJson('{"format":"bitcoin-basis-entries","version":1,"entries":{}}').ok).toBe(false);
    expect(importEntriesJson('{"format":"bitcoin-basis-entries","version":2,"entries":[]}')).toEqual({ ok: false, error: [{ index: null, message: 'unsupported version 2' }] });
    const bad = JSON.stringify({ format: 'bitcoin-basis-entries', version: 1, entries: [entries[0], { ...entries[1], sats: -1 }, 5] });
    expect(importEntriesJson(bad)).toEqual({ ok: false, error: [{ index: 1, message: 'invalid "sats"' }, { index: 2, message: 'entry must be an object' }] });
  });
});

describe('tax-year reports', () => {
  const entries: Entry[] = [
    ...testBook(),
    wallet('cold', 'self-custody', 'Cold storage'),
    wallet('lend', 'exchange', 'Lender'),
    buy('LB', 'lend', '2025-06-01', '0.1', '5000'),
    { id: 'F', kind: 'wallet-freeze', at: noon('2025-07-01'), tz: TZ, wallet: 'lend' },
    { id: 'X', kind: 'wallet-close-out', at: noon('2026-03-01'), tz: TZ, wallet: 'lend', reason: 'Plan' },
    receive('P', 'ex', '2026-04-01', '0.001', '75', { type: 'frozen-payout', fromWallet: 'lend' }),
    sell('S', 'ex', '2026-11-15', [pick('L3', '0.2'), pick('L4', '0.05')], '18750'),
    move('M', 'ex', 'cold', '2026-11-16', sats('0.1'), 2000, '1.50', [{ lotId: 'L2', sats: sats('0.1') + 2000 }]),
    sell('S25', 'ex', '2025-06-01', [pick('L1', '0.01')], '1000'),
    receive('I1', 'ex', '2026-02-01', '0.0003', '25', { type: 'income', description: 'Card rewards, March' }),
    receive('I2', 'ex', '2026-01-01', '0.0001', '9', { type: 'income' }),
    give('G', 'ex', '2026-05-01', [pick('L1', '0.01')], '900', 'person', 'Sam'),
  ];
  test('Form 8949-style CSV: one row per lot piece, short-term first, then by date', () => {
    const csv = form8949Csv(replay(entries), 2026);
    expect(csv.split('\n')).toEqual([
      'term,description,date_acquired,date_sold,proceeds,cost,gain,kind,wallet,tier,entry_id',
      'short,0.10000000 BTC (platform loss),06/01/2025,03/01/2026,0.00,5000.00,-5000.00,close-out,Lender,Documented,X',
      'short,Recovery from Lender,VARIOUS,04/01/2026,75.00,0.00,75.00,recovery,ex,,P',
      'short,0.05000000 BTC,12/20/2025,11/15/2026,3750.00,4400.00,-650.00,sell,ex,Documented,S',
      'long,0.20000000 BTC,02/10/2025,11/15/2026,15000.00,19500.00,-4500.00,sell,ex,Documented,S',
      'long,0.00002000 BTC,01/20/2023,11/16/2026,1.50,0.45,1.05,fee,ex,Documented,M',
      '',
    ]);
  });
  test('Form 8949-style CSV for another year; same-day rows keep entry order', () => {
    const more: Entry[] = [...entries, sell('S25b', 'ex', '2025-06-01', [pick('L1', '0.01')], '1000'), sell('S25a', 'ex', '2025-06-01', [pick('L1', '0.01')], '1000')];
    const rows = form8949Csv(replay(more), 2025).trim().split('\n').slice(1);
    expect(rows.map((r) => r.split(',').at(-1))).toEqual(['S25', 'S25a', 'S25b']);
  });
  test('income list CSV', () => {
    expect(incomeCsv(replay(entries), 2026)).toBe(
      'date,wallet,sats,btc,value_usd,description,entry_id\n2026-01-01,ex,10000,0.00010000,9.00,,I2\n2026-02-01,ex,30000,0.00030000,25.00,"Card rewards, March",I1\n',
    );
    expect(incomeCsv(replay(entries), 2025)).toBe('date,wallet,sats,btc,value_usd,description,entry_id\n');
    expect(cents('25')).toBe(2500);
  });
});
