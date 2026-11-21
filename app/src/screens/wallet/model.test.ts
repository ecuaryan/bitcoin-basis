import { replay, type BalanceConfirmEntry, type BuyEntry, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { trialReplay } from '../log/model.ts';
import { collapseChecks, lastConfirmed, walletEntries } from './model.ts';

const wallet: Entry = { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: 'America/Boise', wallet: 'ex', name: 'Ex', type: 'exchange', defaultProof: '' };
const buy: BuyEntry = { id: 'b1', kind: 'buy', at: '2024-02-01T17:00:00Z', tz: 'America/Boise', wallet: 'ex', sats: 50_000_000, costCents: 2_000_000, tier: 'documented' };
const check = (id: string, at: string, sats = 50_000_000): BalanceConfirmEntry => ({ id, kind: 'balance-confirm', wallet: 'ex', sats, at, tz: 'America/Boise' });

describe('collapseChecks', () => {
  it('folds back-to-back identical checks into one row, newest first', () => {
    const rows = [check('c3', '2024-05-03T17:00:00Z'), check('c2', '2024-05-02T17:00:00Z'), check('c1', '2024-05-01T17:00:00Z'), buy];
    const out = collapseChecks(rows);
    expect(out.map((g) => g.entry.id)).toEqual(['c3', 'b1']);
    expect(out[0]?.same).toHaveLength(3);
  });
  it('keeps checks apart when the balance differs or something sits between them', () => {
    const rows = [check('c3', '2024-05-03T17:00:00Z'), check('c2', '2024-05-02T17:00:00Z', 40_000_000), buy, check('c1', '2024-01-01T17:00:00Z')];
    expect(collapseChecks(rows).map((g) => g.same.length)).toEqual([1, 1, 1, 1]);
  });
});

describe('re-checking a balance', () => {
  it('a replacing check keeps one entry in history and moves the confirmed date', () => {
    const first = check('c1', '2024-05-01T17:00:00Z');
    const again: BalanceConfirmEntry = { ...check('c2', '2024-05-09T17:00:00Z'), replaces: 'c1', reason: 'Re-checked' };
    const entries: Entry[] = [wallet, buy, first];
    expect(trialReplay(entries, replay(entries), [again]).problems).toEqual([]);
    const state = replay([...entries, again]);
    expect(walletEntries([...entries, again], state, 'ex').filter((e) => e.kind === 'balance-confirm').map((e) => e.id)).toEqual(['c2']);
    expect(lastConfirmed(state, 'ex')).toBe('2024-05-09');
  });
});
