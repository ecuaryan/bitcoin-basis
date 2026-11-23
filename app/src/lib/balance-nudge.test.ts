import { holdings, replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_TODAY } from '../demo/demo-data.ts';
import { addDays, balanceNudge, NUDGE_KEY, nudgeSnoozed, snoozeNudge } from './balance-nudge.ts';

const book = buildDemoBook().entries;
const nudgeFor = (entries: readonly Entry[], today: string) => {
  const state = replay(entries);
  return balanceNudge(state, holdings(state), today, entries);
};
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('balance reminder', () => {
  it('is quiet when every live wallet was checked in the last 90 days', () => {
    expect(nudgeFor(book, DEMO_TODAY)).toBeNull();
    expect(nudgeFor(book, '2026-12-31')).toBeNull();
  });
  it('picks the wallet that has waited longest once 90 days pass', () => {
    const state = replay(book);
    const h = holdings(state);
    expect(addDays('2026-11-02', 90)).toBe('2027-01-31');
    // Without the tax-season rule (no entries given), only the 90 days count.
    expect(balanceNudge(state, h, '2027-01-30')).toBeNull();
    expect(balanceNudge(state, h, '2027-01-31')).toMatchObject({ lastChecked: '2026-11-02', why: 'stale' });
  });
  it('asks once in tax season about a wallet used last year and not confirmed since Jan 1', () => {
    // Strike was used in 2026 (Cold storage was not), so it is the one asked about.
    expect(nudgeFor(book, '2027-01-01')).toMatchObject({ lastChecked: '2026-11-20', why: 'tax-season' });
    expect(nudgeFor(book, '2027-04-15')?.why).toBe('stale');
    const state = replay(book);
    // Confirmed this year: quiet until 90 days pass.
    const confirmed = state.balanceChecks.map((c) => ({ ...c, date: '2027-01-02' }));
    expect(balanceNudge({ ...state, balanceChecks: confirmed }, holdings(state), '2027-02-01', book)).toBeNull();
    // Confirmed on Dec 31: still asked once the new year starts, because last year's entries are not confirmed since.
    const late = { ...state, balanceChecks: state.balanceChecks.map((c) => ({ ...c, date: '2026-12-31' })) };
    expect(balanceNudge(late, holdings(state), '2026-12-31', book)).toBeNull();
    expect(balanceNudge(late, holdings(state), '2027-01-05', book)?.why).toBe('tax-season');
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
  it('stays quiet for 30 days, then comes back', () => {
    const store = memory();
    expect(nudgeSnoozed('2026-11-20', store)).toBe(false);
    snoozeNudge('2026-11-20', store);
    expect(store.getItem(NUDGE_KEY)).toBe('2026-12-20');
    expect(nudgeSnoozed('2026-12-19', store)).toBe(true);
    expect(nudgeSnoozed('2026-12-20', store)).toBe(false);
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
