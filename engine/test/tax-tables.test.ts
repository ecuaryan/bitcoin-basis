import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { divRoundHalfUp } from '../src/money.ts';
import { taxForYear, type TaxInput } from '../src/tax/tax.ts';
import { FEDERAL_TABLES, federalTableFor, giftAnnualExclusionFor } from '../src/tax/tables/index.ts';
import { STATE_RATES, US_STATES } from '../src/tax/tables/state.ts';
import { TAX_FILING_STATUSES, type TaxFilingStatus } from '../src/tax/types.ts';

/**
 * The published rate schedules, copied independently from each Rev. Proc. as "over X: base + rate of the
 * excess" rows (cents). Used as a reference: ordinary tax from the engine's brackets must equal these.
 */
type Row = readonly [over: number, base: number, rate: number];
const R = [1000, 1200, 2200, 2400, 3200, 3500, 3700];
const rows = (tops: number[], bases: number[]): Row[] => R.map((rate, i) => [i === 0 ? 0 : (tops[i - 1] as number), i === 0 ? 0 : (bases[i - 1] as number), rate]);

const PUBLISHED: Record<number, Record<Exclude<TaxFilingStatus, 'qualifying-surviving-spouse'>, Row[]>> = {
  2025: {
    'married-joint': rows([23_850_00, 96_950_00, 206_700_00, 394_600_00, 501_050_00, 751_600_00], [2_385_00, 11_157_00, 35_302_00, 80_398_00, 114_462_00, 202_154_50]),
    'head-of-household': rows([17_000_00, 64_850_00, 103_350_00, 197_300_00, 250_500_00, 626_350_00], [1_700_00, 7_442_00, 15_912_00, 38_460_00, 55_484_00, 187_031_50]),
    single: rows([11_925_00, 48_475_00, 103_350_00, 197_300_00, 250_525_00, 626_350_00], [1_192_50, 5_578_50, 17_651_00, 40_199_00, 57_231_00, 188_769_75]),
    'married-separate': rows([11_925_00, 48_475_00, 103_350_00, 197_300_00, 250_525_00, 375_800_00], [1_192_50, 5_578_50, 17_651_00, 40_199_00, 57_231_00, 101_077_25]),
  },
  2026: {
    'married-joint': rows([24_800_00, 100_800_00, 211_400_00, 403_550_00, 512_450_00, 768_700_00], [2_480_00, 11_600_00, 35_932_00, 82_048_00, 116_896_00, 206_583_50]),
    'head-of-household': rows([17_700_00, 67_450_00, 105_700_00, 201_750_00, 256_200_00, 640_600_00], [1_770_00, 7_740_00, 16_155_00, 39_207_00, 56_631_00, 191_171_00]),
    single: rows([12_400_00, 50_400_00, 105_700_00, 201_775_00, 256_225_00, 640_600_00], [1_240_00, 5_800_00, 17_966_00, 41_024_00, 58_448_00, 192_979_25]),
    'married-separate': rows([12_400_00, 50_400_00, 105_700_00, 201_775_00, 256_225_00, 384_350_00], [1_240_00, 5_800_00, 17_966_00, 41_024_00, 58_448_00, 103_291_75]),
  },
  2027: {
    'married-joint': rows([25_600_00, 104_050_00, 218_250_00, 416_650_00, 529_100_00, 793_650_00], [2_560_00, 11_974_00, 37_098_00, 84_714_00, 120_698_00, 213_290_50]),
    'head-of-household': rows([18_250_00, 69_650_00, 109_100_00, 208_300_00, 264_550_00, 661_350_00], [1_825_00, 7_993_00, 16_672_00, 40_480_00, 58_480_00, 197_360_00]),
    single: rows([12_800_00, 52_025_00, 109_125_00, 208_325_00, 264_550_00, 661_375_00], [1_280_00, 5_987_00, 18_549_00, 42_357_00, 60_349_00, 199_237_75]),
    'married-separate': rows([12_800_00, 52_025_00, 109_125_00, 208_325_00, 264_550_00, 396_825_00], [1_280_00, 5_987_00, 18_549_00, 42_357_00, 60_349_00, 106_645_25]),
  },
};

/** Reference: published base + rate × excess, exact in 1/10000 cent, rounded half-up once. */
function publishedTax(year: number, status: TaxFilingStatus, taxable: number): number {
  const sched = PUBLISHED[year]?.[status === 'qualifying-surviving-spouse' ? 'married-joint' : status] as Row[];
  let row = sched[0] as Row;
  for (const r of sched) if (taxable > r[0]) row = r;
  const exact = BigInt(row[1]) * 10_000n + BigInt(taxable - row[0]) * BigInt(row[2]);
  return Number(divRoundHalfUp(exact, 10_000n));
}

const wagesOnly = (year: number, filingStatus: TaxFilingStatus, wages: number): TaxInput => ({
  year, filingStatus, wages, st: 0, lt: 0, carryforward: { st: 0, lt: 0 }, state: { code: 'TX' },
});

describe('federal tables', () => {
  test('one table each for 2025, 2026 and 2027, each with an IRS source', () => {
    expect(FEDERAL_TABLES.map((t) => t.year)).toEqual([2025, 2026, 2027]);
    for (const t of FEDERAL_TABLES) {
      expect(t.sources[0]?.url).toMatch(/^https:\/\/www\.irs\.gov\/pub\/irs-drop\/rp-\d\d-\d\d\.pdf$/);
      for (const s of TAX_FILING_STATUSES) {
        const b = t.ordinary[s];
        expect(b.map((x) => x.rate)).toEqual(R);
        expect(b[6]?.upTo).toBeNull();
      }
    }
  });

  test('2026 married filing jointly matches the known-good figures', () => {
    const t = federalTableFor(2026).table;
    expect(t.standardDeduction['married-joint']).toBe(32_200_00);
    expect(t.ordinary['married-joint'].map((b) => b.upTo)).toEqual([24_800_00, 100_800_00, 211_400_00, 403_550_00, 512_450_00, 768_700_00, null]);
    expect(t.longTerm['married-joint']).toEqual({ zeroTop: 98_900_00, fifteenTop: 613_700_00 });
    expect(t.giftAnnualExclusion).toBe(19_000_00);
  });

  test('standard deductions, long-term bands, gift exclusion per year', () => {
    const [y25, y26, y27] = FEDERAL_TABLES;
    expect(y25?.standardDeduction).toEqual({ 'married-joint': 31_500_00, 'qualifying-surviving-spouse': 31_500_00, 'head-of-household': 23_625_00, single: 15_750_00, 'married-separate': 15_750_00 });
    expect(y26?.standardDeduction).toEqual({ 'married-joint': 32_200_00, 'qualifying-surviving-spouse': 32_200_00, 'head-of-household': 24_150_00, single: 16_100_00, 'married-separate': 16_100_00 });
    expect(y27?.standardDeduction).toEqual({ 'married-joint': 33_200_00, 'qualifying-surviving-spouse': 33_200_00, 'head-of-household': 24_925_00, single: 16_600_00, 'married-separate': 16_600_00 });
    expect(y25?.longTerm.single).toEqual({ zeroTop: 48_350_00, fifteenTop: 533_400_00 });
    expect(y26?.longTerm['head-of-household']).toEqual({ zeroTop: 66_200_00, fifteenTop: 579_600_00 });
    expect(y26?.longTerm['married-separate']).toEqual({ zeroTop: 49_450_00, fifteenTop: 306_850_00 });
    expect(y27?.longTerm['married-joint']).toEqual({ zeroTop: 102_100_00, fifteenTop: 633_600_00 });
    expect([y25?.giftAnnualExclusion, y26?.giftAnnualExclusion, y27?.giftAnnualExclusion]).toEqual([19_000_00, 19_000_00, 20_000_00]);
  });

  test('statutory NIIT thresholds and loss limits', () => {
    for (const t of FEDERAL_TABLES) {
      expect(t.niitThreshold).toEqual({ 'married-joint': 250_000_00, 'qualifying-surviving-spouse': 250_000_00, 'married-separate': 125_000_00, single: 200_000_00, 'head-of-household': 200_000_00 });
      expect(t.capitalLossLimit).toEqual({ 'married-joint': 3_000_00, 'qualifying-surviving-spouse': 3_000_00, 'married-separate': 1_500_00, single: 3_000_00, 'head-of-household': 3_000_00 });
    }
  });

  test('qualifying surviving spouse uses the joint figures', () => {
    for (const t of FEDERAL_TABLES) {
      expect(t.ordinary['qualifying-surviving-spouse']).toEqual(t.ordinary['married-joint']);
      expect(t.longTerm['qualifying-surviving-spouse']).toEqual(t.longTerm['married-joint']);
      expect(t.standardDeduction['qualifying-surviving-spouse']).toBe(t.standardDeduction['married-joint']);
    }
  });

  test('ordinary tax at, just below and just above every bracket top equals the published schedule', () => {
    for (const t of FEDERAL_TABLES) {
      for (const s of TAX_FILING_STATUSES) {
        const tops = t.ordinary[s].flatMap((b) => (b.upTo === null ? [] : [b.upTo]));
        for (const top of tops) {
          for (const taxable of [top - 1, top, top + 1]) {
            const r = taxForYear(wagesOnly(t.year, s, taxable + t.standardDeduction[s]));
            expect(r.netting.taxableIncome).toBe(taxable);
            expect(r.federal).toBe(publishedTax(t.year, s, taxable));
          }
        }
      }
    }
  });

  test('property: ordinary tax equals the published schedule for any wages, year and status', () => {
    fc.assert(
      fc.property(fc.constantFrom(2025, 2026, 2027), fc.constantFrom(...TAX_FILING_STATUSES), fc.integer({ min: 0, max: 2_000_000_00 }), (year, s, wages) => {
        const t = federalTableFor(year).table;
        const taxable = Math.max(0, wages - t.standardDeduction[s]);
        const r = taxForYear(wagesOnly(year, s, wages));
        // No capital items: NIIT and state are zero, so federal is ordinary tax alone.
        expect(r.federal).toBe(publishedTax(year, s, taxable));
        expect(r.state).toBe(0);
      }),
      { numRuns: 3000 },
    );
  });

  test('years after the tables use the latest; years before use the earliest', () => {
    expect(federalTableFor(2026)).toMatchObject({ fellBack: false, table: { year: 2026 } });
    expect(federalTableFor(2030)).toMatchObject({ fellBack: true, table: { year: 2027 } });
    expect(federalTableFor(2019)).toMatchObject({ fellBack: true, table: { year: 2025 } });
  });
});

describe('state table', () => {
  test('every entry has a code, a source and a 2026 year; no-tax states have rate 0', () => {
    for (const [code, s] of Object.entries(STATE_RATES)) {
      expect(s.code).toBe(code);
      expect(s.source).toMatch(/^https:\/\//);
      expect(s.year).toBe(2026);
      if (s.kind === 'none') expect(s.rate).toBe(0);
      else expect(s.rate).toBeGreaterThan(0);
    }
  });

  test('the state list has all 50 states and DC, and every rated state is in it under the same name', () => {
    expect(Object.keys(US_STATES)).toHaveLength(51);
    expect(US_STATES.DC).toBe('District of Columbia');
    for (const [code, s] of Object.entries(STATE_RATES)) expect(US_STATES[code]).toBe(s.name);
    expect(Object.keys(US_STATES).filter((c) => !Object.hasOwn(STATE_RATES, c))).toContain('CA');
  });

  test('Idaho is 5.3%', () => {
    expect(STATE_RATES.ID).toMatchObject({ kind: 'flat', rate: 530 });
    expect(STATE_RATES.ID).not.toHaveProperty('note');
    expect(STATE_RATES.UT).toMatchObject({ rate: 445, note: expect.stringContaining('S.B. 60') });
  });
});

describe('gift annual exclusion by year', () => {
  test('each year its own limit: published years before the tables, then the tables', () => {
    const want: [number, number][] = [
      [2008, 13_000_00],
      [2012, 13_000_00],
      [2013, 14_000_00],
      [2017, 14_000_00],
      [2018, 15_000_00],
      [2021, 15_000_00],
      [2022, 16_000_00],
      [2023, 17_000_00],
      [2024, 18_000_00],
      [2025, 19_000_00],
      [2026, 19_000_00],
    ];
    for (const [year, cents] of want) expect([year, giftAnnualExclusionFor(year)]).toEqual([year, cents]);
  });
});
