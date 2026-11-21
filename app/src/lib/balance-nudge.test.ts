import { holdings, replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_TODAY } from '../demo/demo-data.ts';
import { addDays, balanceNudge, NUDGE_KEY, nudgeSnoozed, snoozeNudge } from './balance-nudge.ts';

const book = buildDemoBook().entries;
const nudgeFor = (entries: readonly Entry[], today: string) => {
  const state = replay(entries);
  return balanceNudge(state, holdings(state), today);
};
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('balance reminder', () => {
  it('is quiet when every live wallet was checked in the last 60 days', () => {
    expect(nudgeFor(book, DEMO_TODAY)).toBeNull();
  });
  it('picks the wallet that has waited longest once 60 days pass', () => {
    const n = nudgeFor(book, '2027-01-05');
    expect(n?.lastChecked).toBe('2026-10-30');
    expect(addDays('2026-11-20', 60)).toBe('2027-01-19');
    expect(nudgeFor(book, '2026-12-28')).toBeNull();
    expect(nudgeFor(book, '2026-12-29')?.lastChecked).toBe('2026-10-30');
  });
  it('asks about a wallet with coins that was never checked, but not an empty one', () => {
    const noChecks = book.filter((e) => e.kind !== 'balance-confirm');
    const n = nudgeFor(noChecks, DEMO_TODAY);
    expect(n?.lastChecked).toBeNull();
    expect(nudgeFor(book.filter((e) => e.kind === 'wallet'), DEMO_TODAY)).toBeNull();
  });
  it('never names frozen, archived or retirement wallets', () => {
    const noChecks = book.filter((e) => e.kind !== 'balance-confirm');
    const state = replay(noChecks);
    const live = new Set(holdings(state).wallets.filter((w) => !w.frozen && !w.archived && w.type !== 'retirement' && w.sats > 0).map((w) => w.wallet));
    expect(live.has(nudgeFor(noChecks, DEMO_TODAY)?.walletId ?? '')).toBe(true);
  });
});

describe('dismissing the reminder', () => {
  it('stays quiet for 60 days, then comes back', () => {
    const store = memory();
    expect(nudgeSnoozed('2026-11-20', store)).toBe(false);
    snoozeNudge('2026-11-20', store);
    expect(store.getItem(NUDGE_KEY)).toBe('2027-01-19');
    expect(nudgeSnoozed('2027-01-18', store)).toBe(true);
    expect(nudgeSnoozed('2027-01-19', store)).toBe(false);
  });
  it('ignores junk and blocked storage', () => {
    expect(nudgeSnoozed('2026-11-20', { getItem: () => 'soon' })).toBe(false);
    expect(
      nudgeSnoozed('2026-11-20', {
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
    expect(() =>
      snoozeNudge('2026-11-20', {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});
