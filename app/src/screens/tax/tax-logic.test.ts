import { createUuidV7, replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_TODAY } from '../../demo/demo-data.ts';
import { answerReason, feeOnlyYes, defaultTaxYear, yearIsOver, flagsForYear, form1099Rows, form8949Detail, joinWords, overExclusion, termWord, totalsByKind, yearsAvailable, yearTaxView, yearLockHistory, nextYearLosses } from './tax-logic.ts';
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
  it('says a year with only a network fee is Yes, because the fee is a tiny sale', () => {
    const fee = replay([
      { id: 'w1', kind: 'wallet', at: '2025-01-01T12:00:00Z', tz: 'UTC', wallet: 'a', name: 'A', type: 'exchange', defaultProof: '' },
      { id: 'w2', kind: 'wallet', at: '2025-01-01T12:00:01Z', tz: 'UTC', wallet: 'b', name: 'B', type: 'self-custody', defaultProof: '' },
      { id: 'b1', kind: 'buy', at: '2025-01-02T12:00:00Z', tz: 'UTC', wallet: 'a', sats: 100_000, costCents: 9_000, tier: 'documented' },
      { id: 'm1', kind: 'move', at: '2026-02-01T12:00:00Z', tz: 'UTC', from: 'a', to: 'b', sats: 90_000, feeSats: 1_500, feeValueCents: 150, picks: [{ lotId: 'b1', sats: 91_500 }] },
    ]);
    const s = yearSummary(fee, 2026);
    expect(feeOnlyYes(s)).toBe(true);
    expect(answerReason(s)).toBe('Yes — paying a network fee in BTC counts as a tiny sale.');
    expect(feeOnlyYes(yearSummary(state, 2026))).toBe(false);
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

describe('losses from past years', () => {
  const amounts = { st: 100_000, lt: 200_000 };
  it('apply to the year they are saved for, and only that year', () => {
    expect(yearTaxView(state, { ...state.settings, carryforwardByYear: { '2025': amounts } }, 2026, DEMO_TODAY).carriedIn).toEqual({ st: 0, lt: 0 });
    expect(yearTaxView(state, { ...state.settings, carryforwardByYear: { '2025': amounts } }, 2025, DEMO_TODAY).carriedIn).toEqual(amounts);
    expect(yearTaxView(state, { ...state.settings, carryforwardByYear: { '2026': amounts } }, 2026, DEMO_TODAY).carriedIn).toEqual(amounts);
  });
  it('are offered for next year when closing, unless Settings already hold them; saving them leaves the closed year alone', () => {
    const loss = { ...state.settings, carryforwardByYear: { '2026': { st: 0, lt: 99_000_000 } } };
    const out = nextYearLosses(state, loss, 2026, DEMO_TODAY);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.st + out.lt).toBeGreaterThan(0);
    const same = { ...loss, carryforwardByYear: { ...loss.carryforwardByYear, '2027': out } };
    expect(nextYearLosses(state, same, 2026, DEMO_TODAY)).toBeNull();
    expect(yearTaxView(state, same, 2026, DEMO_TODAY).carryOut).toEqual(out);
    expect(nextYearLosses(replay([]), { ...state.settings, carryforwardByYear: {}, carryforwardLtCents: 0, carryforwardStCents: 0 }, 2019, DEMO_TODAY)).toBeNull();
  });
});

describe('form1099Rows', () => {
  it('lists exchange wallets with their sales and the gifts sent from them', () => {
    const rows = form1099Rows(state, 2026);
    expect(form1099Rows(state, 1999)).toEqual([]);
    const strike = rows.find((r) => r.wallet.name === 'Strike');
    expect(strike).toBeDefined();
    expect(strike?.sales).toBe(1);
    expect(strike?.gifts).toBe(1);
    expect(strike?.giftCostCents).toBeGreaterThan(0);
    expect(rows.every((r) => r.wallet.type === 'exchange')).toBe(true);
  });
});

describe('form1099Rows: the year is the local date', () => {
  it('counts a purchase at 11:30 PM on Dec 31 (local) in that year, not the next', () => {
    const TZ = 'America/Boise';
    const book: Entry[] = [
      { id: 'w', kind: 'wallet', at: '2025-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
      // 2026-01-01T06:30Z is Dec 31, 2025, 11:30 PM in Boise.
      { id: 'b', kind: 'buy', at: '2026-01-01T06:30:00Z', tz: TZ, wallet: 'ex', sats: 1_000, costCents: 100, tier: 'documented' },
    ];
    const s = replay(book);
    expect(form1099Rows(s, 2025, book).map((r) => r.wallet.id)).toEqual(['ex']);
    expect(form1099Rows(s, 2026, book)).toEqual([]);
  });
});

describe('CPA summary: Form 8949 detail', () => {
  const TZ = 'America/Boise';
  const noon = (d: string) => `${d}T19:00:00Z`;
  const book: Entry[] = [
    { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
    { id: 'w2', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'bad', name: 'Bad', type: 'exchange', defaultProof: '' },
    { id: 'A', kind: 'buy', at: noon('2024-01-10'), tz: TZ, wallet: 'ex', sats: 100_000_000, costCents: 4_000_000, tier: 'documented' },
    { id: 'B', kind: 'buy', at: noon('2024-01-10'), tz: TZ, wallet: 'bad', sats: 100_000_000, costCents: 4_000_000, tier: 'documented' },
    { id: 'F', kind: 'wallet-freeze', at: noon('2024-03-01'), tz: TZ, wallet: 'bad' },
    // A long-term sale at exactly its cost: a $0 gain, still long-term.
    { id: 'S', kind: 'sell', at: noon('2026-02-01'), tz: TZ, wallet: 'ex', sats: 10_000_000, proceedsCents: 400_000, spent: false, picks: [{ lotId: 'A', sats: 10_000_000 }] },
    { id: 'C', kind: 'wallet-close-out', at: noon('2026-05-01'), tz: TZ, wallet: 'bad', reason: 'Failed' },
    { id: 'P', kind: 'receive', at: noon('2026-06-01'), tz: TZ, wallet: 'ex', sats: 1_000_000, valueCents: 150_000, source: { type: 'frozen-payout', fromWallet: 'bad' } },
  ];
  const s = replay(book);
  it('lists the sale, the close-out and the payout after it, as the 8949 CSV does', () => {
    const y = yearSummary(s, 2026);
    expect(s.errors).toEqual([]);
    expect(form8949Detail(y)).toEqual([
      { key: 'S', date: '2026-02-01', wallet: 'ex', kind: 'sell', sats: 10_000_000, proceedsCents: 400_000, costCents: 400_000, gainCents: 0, term: 'long' },
      { key: 'C', date: '2026-05-01', wallet: 'bad', kind: 'close-out', sats: 100_000_000, proceedsCents: 0, costCents: 4_000_000, gainCents: -4_000_000, term: 'long' },
      { key: 'P', date: '2026-06-01', wallet: 'ex', kind: 'recovery', sats: null, proceedsCents: 150_000, costCents: 0, gainCents: 150_000, term: 'long' },
    ]);
    // The gains table's frozen-platform line: the close-out and the payout.
    expect(totalsByKind(y).other).toMatchObject({ count: 2, gainCents: -3_850_000 });
  });
  it('words the term from the holding periods used', () => {
    expect(termWord(['short'])).toBe('short');
    expect(termWord(['long', 'long'])).toBe('long');
    expect(termWord(['long', 'short'])).toBe('both');
    expect(termWord([])).toBe('short');
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
