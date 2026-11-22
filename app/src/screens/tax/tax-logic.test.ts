import { createUuidV7, federalTableFor, giftAnnualExclusionFor, replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_TODAY } from '../../demo/demo-data.ts';
import { answerReason, charityRows, feeOnlyYes, defaultTaxYear, yearIsOver, flagsForYear, form1099Rows, form8949Detail, joinWords, overExclusion, termWord, totalsByKind, yearsAvailable, yearTaxView, yearLockHistory, nextYearLosses } from './tax-logic.ts';
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

describe('gift limit per year', () => {
  const TZ = 'America/Boise';
  const giftOf = (date: string, cents: number): Entry[] => [
    { id: 'w', kind: 'wallet', at: '2015-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
    { id: 'b', kind: 'buy', at: '2015-01-02T19:00:00Z', tz: TZ, wallet: 'ex', sats: 100_000_000, costCents: 30_000, tier: 'documented' },
    { id: 'g', kind: 'give', at: `${date}T19:00:00Z`, tz: TZ, wallet: 'ex', sats: 1_000_000, valueCents: cents, to: 'person', recipient: 'Mom', picks: [{ lotId: 'b', sats: 1_000_000 }] },
  ];
  it('uses each year’s own annual exclusion, not the earliest table’s', () => {
    const limits = [2016, 2017, 2018, 2021, 2022, 2023, 2024, 2025, 2026, 2027].map((y) => giftAnnualExclusionFor(y) / 100);
    expect(limits).toEqual([14_000, 14_000, 15_000, 15_000, 16_000, 17_000, 18_000, 19_000, 19_000, 20_000]);
    // The Log review reads the limit through federalTableFor.
    expect(federalTableFor(2024).table.giftAnnualExclusion).toBe(1_800_000);
    expect(federalTableFor(2009).table.giftAnnualExclusion).toBe(1_300_000);
    expect(federalTableFor(2001).table.giftAnnualExclusion).toBe(1_300_000);
    expect(federalTableFor(2030).table.giftAnnualExclusion).toBe(2_000_000);
  });
  it('an $18,500 gift on Jun 1, 2024 is over that year’s $18,000 limit', () => {
    const s = replay(giftOf('2024-06-01', 1_850_000));
    expect(overExclusion(s, 2024)).toEqual({ over: [expect.objectContaining({ recipient: 'Mom', valueCents: 1_850_000 })], limitCents: 1_800_000 });
    expect(yearTaxView(s, s.settings, 2024, '2026-11-21').giftExclusionCents).toBe(1_800_000);
    // The same gift in 2025 is under $19,000.
    expect(overExclusion(replay(giftOf('2025-06-01', 1_850_000)), 2025).over).toEqual([]);
  });
});

describe('dual basis: flagged in the year the coins are sold', () => {
  const TZ = 'America/Boise';
  const noon = (d: string) => `${d}T19:00:00Z`;
  const base: Entry[] = [
    { id: 'w', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
    { id: 'w2', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'cold', name: 'Cold', type: 'self-custody', defaultProof: '' },
    // Worth $50 when received; the giver paid $9,000.
    { id: 'G', kind: 'receive', at: noon('2024-03-01'), tz: TZ, wallet: 'ex', sats: 100_000, valueCents: 5_000, source: { type: 'gift', giverCostCents: 900_000, giverAcquiredAt: noon('2021-11-01') } },
  ];
  it('a 2026 sale for $70 in the no-gain region is flagged in 2026, as well as the gift in 2024', () => {
    const s = replay([...base, { id: 'S', kind: 'sell', at: noon('2026-02-01'), tz: TZ, wallet: 'ex', sats: 100_000, proceedsCents: 7_000, spent: false, picks: [{ lotId: 'G', sats: 100_000 }] }]);
    expect(form8949Detail(yearSummary(s, 2026))).toEqual([expect.objectContaining({ key: 'S', costCents: 7_000, gainCents: 0 })]);
    expect(flagsForYear(s, 2026)).toEqual([{ entryId: 'S', code: 'dual-basis', message: expect.stringMatching(/^Sale on 2026-02-01 .*dual basis.*Confirm with your CPA\.$/) as string }]);
    expect(flagsForYear(s, 2024).map((f) => [f.entryId, f.code])).toEqual([['G', 'dual-basis']]);
  });
  it('spending, a network fee and a close-out of those coins are flagged in their own years; other sales are not', () => {
    const s = replay([
      ...base,
      { id: 'B', kind: 'buy', at: noon('2024-04-01'), tz: TZ, wallet: 'ex', sats: 100_000, costCents: 7_000, tier: 'documented' },
      { id: 'P', kind: 'sell', at: noon('2025-01-10'), tz: TZ, wallet: 'ex', sats: 10_000, proceedsCents: 900, spent: false, picks: [{ lotId: 'B', sats: 10_000 }] },
      { id: 'X', kind: 'sell', at: noon('2025-02-01'), tz: TZ, wallet: 'ex', sats: 10_000, proceedsCents: 900, spent: true, picks: [{ lotId: 'G', sats: 10_000 }] },
      { id: 'M', kind: 'move', at: noon('2025-03-01'), tz: TZ, from: 'ex', to: 'cold', sats: 10_000, feeSats: 1_000, feeValueCents: 90, picks: [{ lotId: 'G', sats: 11_000 }] },
      { id: 'F', kind: 'wallet-freeze', at: noon('2026-01-05'), tz: TZ, wallet: 'ex' },
      { id: 'C', kind: 'wallet-close-out', at: noon('2027-02-01'), tz: TZ, wallet: 'ex', reason: 'Failed', lossDate: '2026-12-30' },
    ]);
    expect(s.errors).toEqual([]);
    expect(flagsForYear(s, 2025).map((f) => f.message.split(' used')[0])).toEqual(['Spending on 2025-02-01', 'Network fee on 2025-03-01']);
    expect(flagsForYear(s, 2026).map((f) => [f.entryId, f.message.split(' used')[0]])).toEqual([['C', 'Close-out on 2026-12-30']]);
  });
});

describe('charity gifts', () => {
  const TZ = 'America/Boise';
  it('lists each one newest first with its value, deduction and term (spec example 23: $9,000 to a church)', () => {
    const s = replay([
      { id: 'w', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
      { id: 'b', kind: 'buy', at: '2024-01-02T19:00:00Z', tz: TZ, wallet: 'ex', sats: 100_000_000, costCents: 2_000_000, tier: 'documented' },
      { id: 'n', kind: 'buy', at: '2026-01-02T19:00:00Z', tz: TZ, wallet: 'ex', sats: 1_000_000, costCents: 50_000, tier: 'documented' },
      { id: 'c1', kind: 'give', at: '2026-03-01T19:00:00Z', tz: TZ, wallet: 'ex', sats: 10_000_000, valueCents: 900_000, to: 'charity', recipient: 'Church', picks: [{ lotId: 'b', sats: 10_000_000 }] },
      { id: 'c2', kind: 'give', at: '2026-05-01T19:00:00Z', tz: TZ, wallet: 'ex', sats: 1_000_000, valueCents: 90_000, to: 'charity', recipient: 'Food bank', picks: [{ lotId: 'n', sats: 1_000_000 }] },
    ]);
    expect(charityRows(yearSummary(s, 2026))).toEqual([
      { key: 'c2', date: '2026-05-01', recipient: 'Food bank', valueCents: 90_000, deductionCents: 50_000, term: 'short', appraisal: true },
      { key: 'c1', date: '2026-03-01', recipient: 'Church', valueCents: 900_000, deductionCents: 900_000, term: 'long', appraisal: true },
    ]);
    expect(charityRows(yearSummary(s, 2025))).toEqual([]);
  });
});
