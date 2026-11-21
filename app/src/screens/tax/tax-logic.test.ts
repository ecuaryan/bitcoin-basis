import { createUuidV7, replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_TODAY } from '../../demo/demo-data.ts';
import { answerReason, defaultTaxYear, yearIsOver, flagsForYear, form1099Rows, joinWords, overExclusion, totalsByKind, yearsAvailable, yearTaxView, yearLockHistory } from './tax-logic.ts';
import { yearSummary } from '@bitcoin-basis/engine';

const state = replay(buildDemoBook().entries);

describe('joinWords', () => {
  it('joins in plain English', () => {
    expect(joinWords([])).toBe('');
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords(['a', 'b'])).toBe('a and b');
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('answerReason', () => {
  it('says why 2026 is Yes in the demo book', () => {
    const s = yearSummary(state, 2026);
    expect(s.digitalAssetAnswer).toBe('yes');
    expect(answerReason(s)).toMatch(/spent coins/);
    expect(answerReason(s)).toMatch(/Buying and holding alone would be No\.$/);
  });
  it('says No for a quiet year', () => {
    const s = yearSummary(replay([]), 2019);
    expect(answerReason(s)).toMatch(/only bought, moved or held/);
  });
});

describe('yearsAvailable', () => {
  it('lists the current year first, then years with activity', () => {
    const years = yearsAvailable(state, DEMO_TODAY);
    expect(years[0]).toBe(2026);
    expect(years).toEqual([...years].sort((a, b) => b - a));
    expect(years).toContain(2024);
  });
});

describe('totalsByKind and yearTaxView', () => {
  it('adds up to the year summary and applies the carryforward only to the current year', () => {
    const s = yearSummary(state, 2026);
    const t = totalsByKind(s);
    expect(t.sales.stCents + t.spending.stCents + t.fees.stCents + t.other.stCents).toBe(s.stGainCents);
    expect(t.sales.ltCents + t.spending.ltCents + t.fees.ltCents + t.other.ltCents).toBe(s.ltGainCents);
    const now = yearTaxView(state, state.settings, 2026, DEMO_TODAY);
    expect(now.carriedIn.lt).toBe(state.settings.carryforwardLtCents);
    const before = yearTaxView(state, state.settings, 2025, DEMO_TODAY);
    expect(before.carriedIn).toEqual({ st: 0, lt: 0 });
    expect(now.giftExclusionCents).toBe(1_900_000);
  });
});

describe('form1099Rows', () => {
  it('lists exchange wallets with their sales and the gifts sent from them', () => {
    const rows = form1099Rows(state, 2026);
    const strike = rows.find((r) => r.wallet.name === 'Strike');
    expect(strike).toBeDefined();
    expect(strike?.sales).toBe(1);
    expect(strike?.gifts).toBe(1);
    expect(strike?.giftCostCents).toBeGreaterThan(0);
    expect(rows.every((r) => r.wallet.type === 'exchange')).toBe(true);
  });
});

describe('gifts and flags', () => {
  it('finds no recipient over the 2026 limit in the demo book', () => {
    expect(overExclusion(state, 2026).over).toEqual([]);
  });
  it('returns flags only for entries in that year', () => {
    expect(flagsForYear(state, 1999)).toEqual([]);
  });
});

describe('yearLockHistory', () => {
  it('lists closings newest first', () => {
    const id = createUuidV7({ now: () => 1_000 });
    const a = id();
    const b = id();
    const list: Entry[] = [
      { id: a, kind: 'close-year', at: '2026-01-01T00:00:00Z', tz: 'America/Boise', year: 2025 },
      { id: b, kind: 'unlock-year', at: '2026-01-02T00:00:00Z', tz: 'America/Boise', year: 2025, reason: 'Late 1099' },
    ];
    expect(yearLockHistory(list).map((h) => h.kind)).toEqual(['unlock-year', 'close-year']);
  });
});

describe('defaultTaxYear', () => {
  it('opens last year until Apr 15, this year after', () => {
    expect(defaultTaxYear([2026, 2025], '2026-03-01')).toBe(2025);
    expect(defaultTaxYear([2026, 2025], '2026-04-15')).toBe(2025);
    expect(defaultTaxYear([2026, 2025], '2026-04-16')).toBe(2026);
    expect(defaultTaxYear([2026], '2026-02-01')).toBe(2026);
  });
  it('a year is over only after it ends', () => {
    expect(yearIsOver(2026, '2026-12-31')).toBe(false);
    expect(yearIsOver(2025, '2026-01-01')).toBe(true);
  });
});
