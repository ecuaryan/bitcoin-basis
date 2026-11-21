import { replay, type BalanceConfirmEntry, type BuyEntry, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { trialReplay } from '../log/model.ts';
import { buildItems } from '../../lib/entry-list.ts';
import { checkHistory, lastConfirmed, walletEntries } from './model.ts';

const wallet: Entry = { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: 'America/Boise', wallet: 'ex', name: 'Ex', type: 'exchange', defaultProof: '' };
const buy: BuyEntry = { id: 'b1', kind: 'buy', at: '2024-02-01T17:00:00Z', tz: 'America/Boise', wallet: 'ex', sats: 50_000_000, costCents: 2_000_000, tier: 'documented' };
const check = (id: string, at: string, sats = 50_000_000): BalanceConfirmEntry => ({ id, kind: 'balance-confirm', wallet: 'ex', sats, at, tz: 'America/Boise' });

describe('checkHistory', () => {
  it('lists each day once, newest first, re-checks included, and says if it matched', () => {
    const first = check('c1', '2024-05-01T17:00:00Z');
    const again: BalanceConfirmEntry = { ...check('c2', '2024-05-09T17:00:00Z'), replaces: 'c1', reason: 'Re-checked' };
    const same = check('c3', '2024-05-09T18:00:00Z');
    const off = check('c4', '2024-05-10T17:00:00Z', 1);
    const entries: Entry[] = [wallet, buy, first, again, same, off];
    const out = checkHistory(buildItems(entries), replay(entries), 'ex');
    expect(out).toEqual([
      { date: '2024-05-10', times: 1, matched: false },
      { date: '2024-05-09', times: 2, matched: true },
      { date: '2024-05-01', times: 1, matched: true },
    ]);
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
