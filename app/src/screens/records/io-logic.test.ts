import { exportEntriesJson, exportOpeningLotsCsv, replay, createUuidV7 } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook } from '../../demo/demo-data.ts';
import { chunk, guessWalletType, lotsTemplateCsv, planWallets, previewImport, previewJson, previewLots, walletEntries, withoutBadRows } from './io-logic.ts';

const state = replay(buildDemoBook().entries);
const newId = createUuidV7();
const HEAD = 'wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin';
const good = 'Strike,2021-03-15 15:00:00,0.01000000,1000000,300.00,30000.00,Documented,Email receipt';
const bad = 'Nowhere,2021-04-15 15:00:00,0.01000000,1000000,300.00,30000.00,Documented,Email receipt';

describe('guessWalletType', () => {
  it('calls names that sound like your own keys Self-custody', () => {
    for (const n of ['Cold storage (multisig)', 'My Vault', 'Hardware 2', 'Ledger Nano', 'Trezor', 'Coldcard', 'Self custody']) expect(guessWalletType(n)).toBe('self-custody');
  });
  it('calls everything else an Exchange', () => {
    for (const n of ['Strike', 'River', 'Coinbase']) expect(guessWalletType(n)).toBe('exchange');
  });
});

describe('planWallets', () => {
  const head = HEAD;
  const row = (w: string) => good.replace('Strike', w);
  it('counts new wallets once each, in file order, case and spacing ignored', () => {
    const p = planWallets(`${head}\n${row('Zeta')}\n${row('zeta ')}\n${row('Beta')}\n`, state.wallets);
    expect(p.created).toEqual([{ name: 'Zeta', coins: 2 }, { name: 'Beta', coins: 1 }]);
    expect(p.matched).toEqual([]);
  });
  it('keeps exact names as they are and says when a name only differs by case or spacing', () => {
    const name = (state.wallets[0] as { name: string }).name;
    const p = planWallets(`${head}\n${row(name)}\n${row(name.toUpperCase() === name ? name.toLowerCase() : name.toUpperCase())}\n`, state.wallets);
    expect(p.created).toEqual([]);
    expect(p.matched).toHaveLength(1);
    expect(p.matched[0]?.to).toBe(name.trim());
  });
});

describe('previewImport', () => {
  it('makes new wallets before the coins and totals the file', () => {
    const text = `${HEAD}\n${good.replace('Strike', 'Brand New')}\n${good.replace('Strike', 'Brand New')}\n${good.replace('Strike', 'Hardware vault')}\n`;
    const p = previewImport(text, state.wallets, 'America/Boise', newId, [2021]);
    expect(p.problems).toEqual([]);
    expect(p.newWallets.map((w) => [w.name, w.coins, w.guessedType])).toEqual([['Brand New', 2, 'exchange'], ['Hardware vault', 1, 'self-custody']]);
    expect(p.sats).toBe(3_000_000);
    expect(p.costCents).toBe(90_000);
    expect(p.tiers).toEqual({ documented: 3_000_000 });
    expect(p.closedYears).toEqual([2021]);
    const made = walletEntries(p.newWallets, { 'Brand New': 'self-custody' }, '2026-01-01T00:00:00Z', 'America/Boise');
    expect(made.map((w) => w.type)).toEqual(['self-custody', 'self-custody']);
    expect(made.every((w) => w.defaultProof === 'Email receipt')).toBe(true);
    const ids = new Set(made.map((w) => w.wallet));
    expect(p.entries.every((e) => ids.has(e.wallet))).toBe(true);
    expect((made[0]?.id ?? '') < (p.entries[0]?.id ?? '')).toBe(true);
  });
});

describe('chunk', () => {
  it('splits a list into batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('previewLots', () => {
  it('accepts a clean file', () => {
    const p = previewLots(`${HEAD}\n${good}\n`, state.wallets, 'America/Boise', newId);
    expect(p.problems).toEqual([]);
    expect(p.entries).toHaveLength(1);
  });
  it('lists each bad row and counts the good ones', () => {
    const p = previewLots(`${HEAD}\n${good}\n${bad}\n${good}\n`, state.wallets, 'America/Boise', newId);
    expect(p.entries).toEqual([]);
    expect(p.problems).toEqual([{ row: 3, message: 'no wallet named "Nowhere"' }]);
    expect(p.goodRows).toBe(2);
  });
  it('can drop the bad rows and import the rest', () => {
    const text = `${HEAD}\n${good}\n${bad}\n${good}\n`;
    const p = previewLots(text, state.wallets, 'America/Boise', newId);
    const again = previewLots(withoutBadRows(text, p.problems), state.wallets, 'America/Boise', newId);
    expect(again.problems).toEqual([]);
    expect(again.entries).toHaveLength(2);
  });
  it('reports a missing header column once', () => {
    const p = previewLots('wallet,sats\nStrike,1\n', state.wallets, 'America/Boise', newId);
    expect(p.problems).toHaveLength(1);
    expect(p.goodRows).toBe(0);
  });
  it('round-trips the book\'s own export', () => {
    const csv = exportOpeningLotsCsv(state).csv;
    expect(previewLots(csv, state.wallets, 'America/Boise', newId).problems).toEqual([]);
  });
});

describe('previewJson', () => {
  it('separates new entries from ones already in the book', () => {
    const entries = buildDemoBook().entries;
    const text = exportEntriesJson(entries);
    const half = new Set(entries.slice(0, 10).map((e) => e.id));
    const p = previewJson(text, half);
    expect(p.entries).toHaveLength(entries.length);
    expect(p.fresh).toHaveLength(entries.length - 10);
  });
  it('explains a file that is not ours', () => {
    expect(previewJson('{"a":1}', new Set()).problems[0]?.message).toMatch(/not a Bitcoin Basis/);
    expect(previewJson('nope', new Set()).problems[0]?.index).toBeNull();
  });
});

describe('lotsTemplateCsv', () => {
  it('has the importer columns and an example row that imports cleanly', () => {
    const csv = lotsTemplateCsv('Strike', 'America/Boise');
    expect(csv.split(/\r?\n/)[0]).toBe(`${HEAD},tz`);
    const p = previewLots(csv, state.wallets, 'America/Boise', newId);
    expect(p.problems).toEqual([]);
    expect(p.entries).toHaveLength(1);
  });
});
