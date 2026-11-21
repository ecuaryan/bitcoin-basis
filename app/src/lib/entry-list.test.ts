import { replay, type Entry } from '@bitcoin-basis/engine';
import { describe as suite, expect, it } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { describeEntry as describe } from './describe-entry.ts';
import { buildItems, collapseRuns, entryRows, entryYears, kindGroup, matches, NO_FILTER, userEdited, type EntryFilter } from './entry-list.ts';

const tz = 'America/Boise';
const entry = <T extends Entry['kind']>(e: Extract<Entry, { kind: T }>): Entry => e;
const wallet = entry({ id: 'w1', kind: 'wallet', at: '2026-01-01T00:00:00Z', tz, wallet: 'strike', name: 'Strike', type: 'exchange', defaultProof: 'Email' });
const buy1 = entry({ id: 'b1', kind: 'buy', at: '2026-02-01T00:00:00Z', tz, wallet: 'strike', sats: 100_000, costCents: 5_000, tier: 'documented' });
const buy2 = entry({ id: 'b2', kind: 'buy', at: '2026-02-01T00:00:00Z', tz, wallet: 'strike', sats: 150_000, costCents: 7_500, tier: 'documented', replaces: 'b1', reason: 'Wrong amount' });
const del = entry({ id: 'd1', kind: 'delete', at: '2026-03-01T00:00:00Z', tz, replaces: 'b2', reason: 'Duplicate' });
const names = new Map(replay([wallet]).wallets.map((w) => [w.id, w]));

suite('buildItems', () => {
  it('groups an edit under its first entry and keeps the history', () => {
    const items = buildItems([wallet, buy1, buy2]);
    const item = items.find((i) => i.id === 'b1');
    expect(items).toHaveLength(2);
    expect(item?.versions.map((v) => v.id)).toEqual(['b1', 'b2']);
    expect(item?.current.id).toBe('b2');
    expect(item?.deleted).toBe(false);
  });
  it('marks a deleted item and shows the version before the delete', () => {
    const item = buildItems([wallet, buy1, buy2, del]).find((i) => i.id === 'b1');
    expect(item?.deleted).toBe(true);
    expect(item?.current.id).toBe('b2');
  });
  it('flags two edits of the same entry as a conflict', () => {
    const other = { ...buy2, id: 'b3', sats: 1 };
    const item = buildItems([buy1, buy2, other]).find((i) => i.id === 'b1');
    expect(item?.conflict).toBe(true);
    expect(item?.versions).toHaveLength(3);
  });
  it('puts the newest first', () => {
    expect(buildItems([wallet, buy1]).map((i) => i.id)).toEqual(['b1', 'w1']);
  });
  it('handles the whole demo book', () => {
    const { entries } = buildDemoBook();
    expect(buildItems(entries)).toHaveLength(entries.length);
  });
});

suite('describe', () => {
  it('names a buy', () => {
    const line = describe(buy1, names);
    expect(line).toMatchObject({ title: 'Bought', detail: 'Strike', sats: 100_000, sign: '+', cents: 5_000 });
  });
  it('also gives the one-line summary the wallet history uses', () => {
    expect(describe(buy1, names)).toMatchObject({ summary: 'Bought', centsLabel: 'paid' });
  });
  it('names a settings change in words', () => {
    const e = entry({ id: 's', kind: 'settings', at: '2026-01-01T00:00:00Z', tz, patch: { wagesCents: 1 } });
    expect(describe(e, names).detail).toBe('wages');
  });
});

suite('filters', () => {
  const items = buildItems([wallet, buy1, buy2]);
  const none: EntryFilter = { text: '', wallet: '', group: '', year: '' };
  const buyItem = items.find((i) => i.id === 'b1') as ReturnType<typeof buildItems>[number];
  it('filters by kind, wallet, year and text', () => {
    expect(matches(buyItem, none, names)).toBe(true);
    expect(matches(buyItem, { ...none, group: 'sold' }, names)).toBe(false);
    expect(matches(buyItem, { ...none, group: 'bought' }, names)).toBe(true);
    expect(matches(buyItem, { ...none, wallet: 'river' }, names)).toBe(false);
    expect(matches(buyItem, { ...none, wallet: 'strike' }, names)).toBe(true);
    expect(matches(buyItem, { ...none, year: '2025' }, names)).toBe(false);
    expect(matches(buyItem, { ...none, year: '2026' }, names)).toBe(true);
    expect(matches(buyItem, { ...none, text: 'strike bought' }, names)).toBe(true);
    expect(matches(buyItem, { ...none, text: 'coinbase' }, names)).toBe(false);
  });
  it('lists years and groups kinds', () => {
    expect(entryYears(items)).toEqual([2026, 2025]); // the wallet entry is Dec 31 in Boise
    expect(kindGroup('opening-lot')).toBe('imported');
    expect(kindGroup('wallet-freeze')).toBe('wallets');
  });
});

suite('settings noise', () => {
  const set = (id: string, at: string, patch: object): Entry => entry({ id, kind: 'settings', at, tz, patch });
  const conf = (id: string, at: string, sats = 100): Entry => entry({ id, kind: 'balance-confirm', at, tz, wallet: 'strike', sats });
  const none: EntryFilter = { text: '', wallet: '', group: '', year: '' };
  const book = [wallet, set('s1', '2026-05-01T10:00:00Z', { givingEnabled: true }), set('s2', '2026-05-01T10:01:00Z', { givingEnabled: false }), set('s3', '2026-05-01T10:02:00Z', { givingEnabled: true, givingMode: 'after-tax' }), conf('c1', '2026-05-02T10:00:00Z'), conf('c2', '2026-05-03T10:00:00Z')];
  const items = buildItems(book);
  it('hides settings entries unless Kind is Settings, and never lists balance confirmations', () => {
    expect(items.filter((i) => matches(i, none, names)).map((i) => i.id)).toEqual(['w1']);
    expect(items.filter((i) => matches(i, { ...none, group: 'checks' }, names))).toHaveLength(0);
    expect(items.filter((i) => matches(i, { ...none, wallet: 'strike' }, names)).map((i) => i.id)).toEqual(['w1']);
    expect(items.filter((i) => matches(i, { ...none, group: 'settings' }, names))).toHaveLength(3);
  });
  it('folds a run of settings changes into one row with the net change', () => {
    const rows = collapseRuns(items.filter((i) => matches(i, { ...none, group: 'settings' }, names)), items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(3);
    expect(rows[0]?.net).toBe('Giving turned on · after tax');
  });
  it('says so when toggles cancel out', () => {
    const b = buildItems([wallet, set('s1', '2026-05-01T10:00:00Z', { givingEnabled: true }), set('s2', '2026-05-01T10:01:00Z', { givingEnabled: false })]);
    expect(collapseRuns(b.filter((i) => i.id !== 'w1'), b)[0]?.net).toBe('No net change');
  });
  it('counts what the list shows: entryRows is the one source for every list', () => {
    const rows = entryRows(items, NO_FILTER, names);
    expect(rows.map((r) => r.item.id)).toEqual(['w1']);
    expect(entryRows(items, { ...NO_FILTER, group: 'settings' }, names)).toHaveLength(1);
  });
});

suite('edited or not', () => {
  const conf = (id: string, at: string, extra: object = {}): Entry => entry({ id, kind: 'balance-confirm', at, tz, wallet: 'strike', sats: 100, ...extra });
  it('a re-checked balance is not an edit; a changed amount is', () => {
    const b = buildItems([conf('c1', '2026-05-02T10:00:00Z'), conf('c2', '2026-05-09T10:00:00Z', { replaces: 'c1', reason: 'Re-checked' })]);
    expect(b).toHaveLength(1);
    expect(userEdited(b[0] as (typeof b)[number])).toBe(false);
    const e = buildItems([wallet, buy1, buy2]).find((i) => i.id === 'b1');
    expect(e && userEdited(e)).toBe(true);
    const d = buildItems([wallet, buy1, buy2, del]).find((i) => i.id === 'b1');
    expect(d && userEdited(d)).toBe(false);
  });
  it('a payout from a frozen wallet shows in both wallets', () => {
    const payout = entry({ id: 'p', kind: 'receive', at: '2026-05-02T10:00:00Z', tz, wallet: 'river', sats: 5, valueCents: 1, source: { type: 'frozen-payout', fromWallet: 'strike' } });
    const [item] = buildItems([payout]);
    expect(item && matches(item, { ...NO_FILTER, wallet: 'strike' }, names)).toBe(true);
    expect(item && matches(item, { ...NO_FILTER, wallet: 'river' }, names)).toBe(true);
  });
});
