import { replay, type BuyEntry, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { amountText, choosePicks, localInputFor, lotsAvailable, parseAmount, trialReplay, zonedInstant } from './model.ts';

const wallet: Entry = { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: 'America/Boise', wallet: 'ex', name: 'Ex', type: 'exchange', defaultProof: '' };
const buy = (id: string, at: string, sats: number, costCents: number): BuyEntry => ({ id, kind: 'buy', at, tz: 'America/Boise', wallet: 'ex', sats, costCents, tier: 'documented' });
const book: Entry[] = [wallet, buy('b1', '2024-02-01T17:00:00Z', 50_000_000, 2_000_000), buy('b2', '2025-03-01T17:00:00Z', 30_000_000, 2_400_000)];

describe('amounts', () => {
  it('parses BTC, sats and USD without floats', () => {
    expect(parseAmount('0.0074 2665', 'btc', null)).toBe(742_665);
    expect(parseAmount('1,500', 'sats', null)).toBe(1500);
    expect(parseAmount('$750', 'usd', 7_500_000)).toBe(1_000_000);
    expect(parseAmount('750', 'usd', null)).toBeNull();
    expect(parseAmount('0.123456789', 'btc', null)).toBeNull();
  });
  it('keeps the same amount when switching units', () => {
    expect(amountText(1_000_000, 'usd', 7_500_000)).toBe('750.00');
    expect(amountText(1_000_000, 'btc', null)).toBe('0.01000000');
  });
});

describe('time zones', () => {
  it('round-trips a wall-clock time in Boise', () => {
    const at = zonedInstant('2026-11-20T12:00', 'America/Boise');
    expect(at).toBe('2026-11-20T19:00:00Z');
    expect(localInputFor(at as string, 'America/Boise')).toBe('2026-11-20T12:00');
    expect(zonedInstant('2026-07-04T12:00', 'America/Boise')).toBe('2026-07-04T18:00:00Z');
  });
});

describe('coin choice and trial replay', () => {
  const state = replay(book);
  it('oldest first, or only the ticked coins', () => {
    const lots = lotsAvailable(state, book, 'ex', '2026-01-01T00:00:00Z');
    expect(choosePicks(lots, 60_000_000, 'oldest', new Set())).toEqual([
      { lotId: 'b1', sats: 50_000_000 },
      { lotId: 'b2', sats: 10_000_000 },
    ]);
    expect(choosePicks(lots, 10_000_000, 'hand', new Set(['b2']))).toEqual([{ lotId: 'b2', sats: 10_000_000 }]);
    expect(choosePicks(lots, 10_000_000, 'hand', new Set())).toBeNull();
  });
  it('hides coins that did not exist yet', () => {
    expect(lotsAvailable(state, book, 'ex', '2024-06-01T00:00:00Z').map((l) => l.id)).toEqual(['b1']);
  });
  it('reports a sale that would break and a delete that breaks later entries', () => {
    const sell: Entry = { id: 's1', kind: 'sell', at: '2026-01-01T00:00:00Z', tz: 'America/Boise', wallet: 'ex', sats: 90_000_000, proceedsCents: 1, picks: [{ lotId: 'b1', sats: 90_000_000 }], spent: false };
    expect(trialReplay(book, state, [sell]).problems.length).toBeGreaterThan(0);
    const okSell: Entry = { ...sell, sats: 10_000_000, picks: [{ lotId: 'b1', sats: 10_000_000 }] };
    const withSell = [...book, okSell];
    const del: Entry = { id: 'd1', kind: 'delete', at: '2026-02-01T00:00:00Z', tz: 'America/Boise', replaces: 'b1', reason: 'x' };
    expect(trialReplay(withSell, replay(withSell), [del], 'b1').problems.length).toBeGreaterThan(0);
  });
});
