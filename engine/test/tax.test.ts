import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { capitalTaxEffect, incrementalTax, marginalRates, taxForYear, type TaxInput } from '../src/tax/tax.ts';
import type { StateCode } from '../src/tax/tables/state.ts';
import type { TaxFilingStatus } from '../src/tax/types.ts';

/** Worked-example household: married filing jointly, 2026, wages $130,000, Idaho. */
const base: TaxInput = { year: 2026, filingStatus: 'married-joint', wages: 130_000_00, st: 0, lt: 0, carryforward: { st: 0, lt: 0 }, state: { code: 'ID' } };
const io = (patch: Partial<TaxInput>): TaxInput => ({ ...base, ...patch });

describe('worked examples', () => {
  test('1: $4,750 long-term gain → federal $547.50 + Idaho $251.75 = $799.25', () => {
    expect(capitalTaxEffect(io({ lt: 4_750_00 }))).toMatchObject({ federal: 547_50, state: 251_75, total: 799_25, carryforwardOut: { st: 0, lt: 0 } });
    const r = taxForYear(io({ lt: 4_750_00 }));
    // Wages-only tax on $97,800 taxable is $11,240.00.
    expect(r).toMatchObject({ federal: 11_787_50, state: 251_75, total: 12_039_25 });
    expect(r.federalParts).toEqual({ ordinary: 11_240_00, longTerm: 547_50, niit: 0 });
    expect(r.netting).toEqual({ st: 0, lt: 4_750_00, net: 4_750_00, lossDeduction: 0, includedInIncome: 4_750_00, preferential: 4_750_00, taxableIncome: 102_550_00 });
    expect(r.assumptions).toMatchObject({ year: 2026, tableYear: 2026, fellBack: false, standardDeduction: 32_200_00, capitalLossLimit: 3_000_00, notes: [] });
    expect(r.assumptions.state).toMatchObject({ code: 'ID', name: 'Idaho', rate: 530, year: 2026 });
  });

  test('2: short −$650, long −$4,500 → $3,000 deducted, $2,150.00 long carries forward, −$519.00', () => {
    const e = capitalTaxEffect(io({ st: -650_00, lt: -4_500_00 }));
    expect(e).toMatchObject({ federal: -360_00, state: -159_00, total: -519_00, carryforwardOut: { st: 0, lt: 2_150_00 } });
    expect(taxForYear(io({ st: -650_00, lt: -4_500_00 })).netting.lossDeduction).toBe(3_000_00);
  });

  test('3: difference 1 − 2 = $1,318.25', () => {
    const r = incrementalTax(io({ st: -650_00, lt: -4_500_00 }), io({ lt: 4_750_00 }));
    expect(r).toMatchObject({ total: 1_318_25, carryforwardOut: { st: 0, lt: 0 }, baseCarryforwardOut: { st: 0, lt: 2_150_00 } });
  });

  test('6: $10,000 short-term gain → $1,900 + $530 = $2,430.00', () => {
    expect(capitalTaxEffect(io({ st: 10_000_00 }))).toMatchObject({ federal: 1_900_00, state: 530_00, total: 2_430_00 });
  });

  test('7: $100,000 long-term gain on $300,000 wages → $15,000 + $3,800 NIIT + $5,300 = $24,100.00', () => {
    const input = io({ wages: 300_000_00, lt: 100_000_00 });
    expect(capitalTaxEffect(input)).toMatchObject({ federal: 18_800_00, state: 5_300_00, total: 24_100_00 });
    expect(taxForYear(input).federalParts).toMatchObject({ longTerm: 15_000_00, niit: 3_800_00 });
  });

  test('8: $5,000 short gain, $8,000 long loss → −$519.00, nothing carries', () => {
    expect(capitalTaxEffect(io({ st: 5_000_00, lt: -8_000_00 }))).toMatchObject({ total: -519_00, carryforwardOut: { st: 0, lt: 0 } });
  });

  test('9: $2,000 short loss, $10,000 long gain → $1,459.00', () => {
    expect(capitalTaxEffect(io({ st: -2_000_00, lt: 10_000_00 }))).toMatchObject({ federal: 1_035_00, state: 424_00, total: 1_459_00 });
  });

  test('10: $10,000 long loss → $3,000 deducted, $7,000 carries forward, −$519.00', () => {
    expect(capitalTaxEffect(io({ lt: -10_000_00 }))).toMatchObject({ total: -519_00, carryforwardOut: { st: 0, lt: 7_000_00 } });
  });

  test('16: $4,750 long gain with a $6,000 long carryforward → −$216.25, nothing carries', () => {
    const withSale = io({ lt: 4_750_00, carryforward: { st: 0, lt: 6_000_00 } });
    expect(capitalTaxEffect(withSale)).toMatchObject({ federal: -150_00, state: -66_25, total: -216_25, carryforwardOut: { st: 0, lt: 0 } });
    // The carryforward alone deducts $3,000 (−$519.00) and carries $3,000; the sale adds $302.75.
    const alone = io({ carryforward: { st: 0, lt: 6_000_00 } });
    expect(capitalTaxEffect(alone)).toMatchObject({ total: -519_00, carryforwardOut: { st: 0, lt: 3_000_00 } });
    expect(incrementalTax(alone, withSale)).toMatchObject({
      federal: 210_00, state: 92_75, total: 302_75, carryforwardOut: { st: 0, lt: 0 }, baseCarryforwardOut: { st: 0, lt: 3_000_00 },
    });
  });

  test('S: $24,800 carryforward; gain $12,953.10 vs loss −$3,746.90 → $8,846.90 vs $25,546.90 into next year', () => {
    const cf = { st: 0, lt: 24_800_00 };
    const oldest = taxForYear(io({ lt: 12_953_10, carryforward: cf }));
    const lowest = taxForYear(io({ lt: -3_746_90, carryforward: cf }));
    expect(oldest.carryforwardOut).toEqual({ st: 0, lt: 8_846_90 });
    expect(lowest.carryforwardOut).toEqual({ st: 0, lt: 25_546_90 });
    expect(oldest.netting.lossDeduction).toBe(3_000_00);
    expect(lowest.netting.lossDeduction).toBe(3_000_00);
    // $3,000 against wages either way, so the tax is the same.
    expect(incrementalTax(io({ carryforward: cf }), io({ lt: 12_953_10, carryforward: cf })).total).toBe(0);
  });
});

describe('netting and carryforward character (§ 1212(b))', () => {
  const cf = (input: TaxInput): unknown => taxForYear(input).carryforwardOut;

  test('the deduction uses short-term loss first', () => {
    expect(cf(io({ st: -5_000_00, lt: -5_000_00 }))).toEqual({ st: 2_000_00, lt: 5_000_00 });
    expect(cf(io({ st: -1_000_00, lt: -5_000_00 }))).toEqual({ st: 0, lt: 3_000_00 });
  });

  test('a gain of one character absorbs the other character’s loss first', () => {
    expect(cf(io({ st: -5_000_00, lt: 1_000_00 }))).toEqual({ st: 1_000_00, lt: 0 });
    expect(cf(io({ st: 1_000_00, lt: -5_000_00 }))).toEqual({ st: 0, lt: 1_000_00 });
  });

  test('carryforward joins its own character before cross-netting', () => {
    const r = taxForYear(io({ st: 2_000_00, lt: 1_000_00, carryforward: { st: 5_000_00, lt: 0 } }));
    expect(r.netting).toMatchObject({ st: -3_000_00, lt: 1_000_00, net: -2_000_00, lossDeduction: 2_000_00 });
    expect(r.carryforwardOut).toEqual({ st: 0, lt: 0 });
    const g = taxForYear(io({ st: 2_000_00, lt: 6_000_00, carryforward: { st: 0, lt: 5_000_00 } }));
    expect(g.netting).toMatchObject({ st: 2_000_00, lt: 1_000_00, net: 3_000_00, preferential: 1_000_00 });
  });

  test('a short gain with a smaller long loss is all ordinary', () => {
    const r = taxForYear(io({ st: 5_000_00, lt: -2_000_00 }));
    expect(r.netting).toMatchObject({ net: 3_000_00, preferential: 0, includedInIncome: 3_000_00 });
    expect(capitalTaxEffect(io({ st: 5_000_00, lt: -2_000_00 })).federal).toBe(360_00);
  });

  test('married filing separately deducts at most $1,500', () => {
    const r = taxForYear(io({ filingStatus: 'married-separate', wages: 100_000_00, lt: -5_000_00 }));
    expect(r.netting.lossDeduction).toBe(1_500_00);
    expect(r.carryforwardOut).toEqual({ st: 0, lt: 3_500_00 });
    expect(r.assumptions.capitalLossLimit).toBe(1_500_00);
  });

  test('a loss deduction that cannot reduce taxable income is not used and carries forward (§ 1212(b)(2))', () => {
    const none = taxForYear(io({ wages: 0, st: -5_000_00 }));
    expect(none.netting).toMatchObject({ lossDeduction: 0, includedInIncome: 0, taxableIncome: 0 });
    expect(none.carryforwardOut).toEqual({ st: 5_000_00, lt: 0 });
    expect(capitalTaxEffect(io({ wages: 0, st: -5_000_00 })).total).toBe(0);
    // $1,000 of taxable income before the deduction: $1,000 used, $4,000 carries.
    const part = io({ wages: 33_200_00, lt: -5_000_00 });
    expect(taxForYear(part).carryforwardOut).toEqual({ st: 0, lt: 4_000_00 });
    expect(capitalTaxEffect(part)).toMatchObject({ federal: -100_00, state: -53_00, total: -153_00 });
  });
});

describe('federal computation', () => {
  test('zero and negative taxable income', () => {
    const r = taxForYear(io({ wages: 10_000_00 }));
    expect(r).toMatchObject({ federal: 0, state: 0, total: 0, netting: { taxableIncome: 0 } });
    // A gain below the standard deduction gap is untaxed federally; the state still taxes the gain.
    expect(capitalTaxEffect(io({ wages: 10_000_00, st: 5_000_00 }))).toMatchObject({ federal: 0, state: 265_00 });
    // Long-term gain is limited to taxable income and sits in the 0% band.
    const lt = taxForYear(io({ wages: 0, lt: 100_000_00 }));
    expect(lt.netting).toMatchObject({ taxableIncome: 67_800_00, preferential: 67_800_00 });
    expect(lt.federal).toBe(0);
  });

  test('long-term gain spanning the 15% and 20% bands', () => {
    expect(capitalTaxEffect(io({ wages: 600_000_00, lt: 100_000_00 })).federal).toBe(17_705_00 + 3_800_00);
    expect(taxForYear(io({ wages: 700_000_00, lt: 100_000_00 })).federalParts).toMatchObject({ longTerm: 20_000_00, niit: 3_800_00 });
  });

  test('preferential tax is capped at ordinary tax on all taxable income (worksheet "smaller of")', () => {
    // Ordinary taxable income $98,900 (top of the 0% band) inside the 12% bracket: 15% on $1,900 = $285
    // would exceed 12% = $228, so the cap applies.
    const r = capitalTaxEffect(io({ wages: 131_100_00, lt: 1_900_00 }));
    expect(r.federal).toBe(228_00);
  });

  test('NIIT boundary: MAGI exactly at the threshold, one cent over, and limited by investment income', () => {
    expect(taxForYear(io({ wages: 240_000_00, lt: 10_000_00 })).federalParts.niit).toBe(0);
    expect(taxForYear(io({ wages: 240_000_00, lt: 10_000_01 })).federalParts.niit).toBe(0); // 3.8% of 1 cent
    expect(taxForYear(io({ wages: 240_000_00, lt: 10_000_14 })).federalParts.niit).toBe(1); // 3.8% of 14 cents = 0.532
    expect(taxForYear(io({ wages: 240_000_00, lt: 20_000_00 })).federalParts.niit).toBe(380_00);
    expect(taxForYear(io({ wages: 400_000_00, lt: 10_000_00 })).federalParts.niit).toBe(380_00);
    expect(taxForYear(io({ filingStatus: 'married-separate', wages: 120_000_00, st: 10_000_00 })).federalParts.niit).toBe(190_00);
    // Losses never create negative NIIT.
    expect(taxForYear(io({ wages: 400_000_00, lt: -10_000_00 })).federalParts.niit).toBe(0);
  });

  test('every filing status, 2026, wages $60,000 + $10,000 long-term gain', () => {
    const expected: Record<TaxFilingStatus, number> = {
      single: 667_50, // $43,900 + $10,000 straddles the $49,450 top of the 0% band: 15% × $4,450
      'married-separate': 667_50,
      'head-of-household': 0, // $35,850 + $10,000 is under $66,200
      'married-joint': 0,
      'qualifying-surviving-spouse': 0,
    };
    for (const [filingStatus, fed] of Object.entries(expected) as [TaxFilingStatus, number][]) {
      expect(capitalTaxEffect(io({ filingStatus, wages: 60_000_00, lt: 10_000_00, state: { code: 'TX' } }))).toMatchObject({ federal: fed, state: 0, total: fed });
    }
  });

  test('every filing status, 2026, $20,000 short-term gain at the top of the 22% bracket', () => {
    const tops: Record<TaxFilingStatus, number> = { single: 105_700_00, 'married-separate': 105_700_00, 'head-of-household': 105_700_00, 'married-joint': 211_400_00, 'qualifying-surviving-spouse': 211_400_00 };
    const ded: Record<TaxFilingStatus, number> = { single: 16_100_00, 'married-separate': 16_100_00, 'head-of-household': 24_150_00, 'married-joint': 32_200_00, 'qualifying-surviving-spouse': 32_200_00 };
    // MAGI over the NIIT threshold: MFS $141,800 − $125,000; joint $263,600 − $250,000 (3.8%).
    const niit: Record<TaxFilingStatus, number> = { single: 0, 'married-separate': 638_40, 'head-of-household': 0, 'married-joint': 516_80, 'qualifying-surviving-spouse': 516_80 };
    for (const s of Object.keys(tops) as TaxFilingStatus[]) {
      // Gain fills the 22% bracket exactly up to its top, or starts at the top and is all at 24%.
      const wagesAtTop = tops[s] + ded[s];
      expect(capitalTaxEffect(io({ filingStatus: s, wages: wagesAtTop - 20_000_00, st: 20_000_00, state: { customRate: 0 } })).federal).toBe(4_400_00);
      expect(capitalTaxEffect(io({ filingStatus: s, wages: wagesAtTop, st: 20_000_00, state: { customRate: 0 } })).federal).toBe(4_800_00 + niit[s]);
    }
  });
});

describe('state', () => {
  test('custom rate, with and without a label; no-tax states', () => {
    const custom = taxForYear(io({ lt: 10_000_00, state: { customRate: 650, label: 'Oregon (my rate)' } }));
    expect(custom.state).toBe(650_00);
    expect(custom.assumptions.state).toEqual({ code: null, name: 'Oregon (my rate)', rate: 650, year: null, source: null });
    expect(taxForYear(io({ lt: 10_000_00, state: { customRate: 0 } })).assumptions.state.name).toBe('Custom rate');
    expect(taxForYear(io({ lt: 10_000_00, state: { code: 'TX' } })).state).toBe(0);
  });

  test('a deductible net loss reduces state tax like federal', () => {
    expect(capitalTaxEffect(io({ st: -10_000_00, state: { code: 'IL' } })).state).toBe(-148_50);
  });

  test('state and federal round separately; total rounds the exact sum', () => {
    // 1 cent of short-term gain: federal 12% = 0.12¢ → 0, Idaho 5.3% = 0.053¢ → 0, total 0.173¢ → 0.
    // 3 cents: federal 0.36¢ → 0, state 0.159¢ → 0, total 0.519¢ → 1.
    expect(capitalTaxEffect(io({ st: 3 }))).toMatchObject({ federal: 0, state: 0, total: 1 });
    // Halves round away from zero: 50% of ±1 cent is ±0.5¢ → ±1.
    expect(capitalTaxEffect(io({ st: 1, state: { customRate: 5_000 } }))).toMatchObject({ federal: 0, state: 1, total: 1 });
    expect(capitalTaxEffect(io({ st: -1, state: { customRate: 5_000 } }))).toMatchObject({ federal: 0, state: -1, total: -1 });
  });
});

describe('years', () => {
  test('missing year falls back to the latest table and says so', () => {
    const r = taxForYear(io({ year: 2031, lt: 1_000_00 }));
    expect(r.assumptions).toMatchObject({ year: 2031, tableYear: 2027, fellBack: true, standardDeduction: 33_200_00 });
    expect(r.assumptions.notes).toEqual(['No 2031 federal table; used the 2027 figures.', 'State rate is the 2026 rate.']);
  });

  test('2025 and 2027 tables are used for their own years', () => {
    const r25 = taxForYear(io({ year: 2025 }));
    expect(r25.assumptions).toMatchObject({ tableYear: 2025, fellBack: false, standardDeduction: 31_500_00 });
    expect(r25.assumptions.notes).toEqual(['State rate is the 2026 rate.']);
    expect(taxForYear(io({ year: 2027, state: { customRate: 500 } })).assumptions.notes).toEqual([]);
  });
});

describe('marginal rates', () => {
  test('worked-example household: 12% + 5.3% short, 0% + 5.3% long', () => {
    const r = marginalRates(base);
    expect(r.st).toBeCloseTo(0.173, 12);
    expect(r.lt).toBeCloseTo(0.053, 12);
  });

  test('high income: 35% + NIIT + state short, 20% + NIIT + state long', () => {
    const r = marginalRates(io({ wages: 700_000_00, lt: 100_000_00 }));
    expect(r.st).toBeCloseTo(0.35 + 0.038 + 0.053, 12);
    expect(r.lt).toBeCloseTo(0.2 + 0.038 + 0.053, 12);
  });

  test('a net loss within the limit: the next dollar of either kind cancels deduction at the ordinary rate', () => {
    const r = marginalRates(io({ lt: -1_000_00 }));
    expect(r.st).toBeCloseTo(0.173, 12);
    expect(r.lt).toBeCloseTo(0.173, 12);
  });

  test('losses beyond the limit absorb the next dollar → rates at the wages-only position', () => {
    const r = marginalRates(io({ carryforward: { st: 0, lt: 50_000_00 } }));
    expect(r.st).toBeCloseTo(0.173, 12);
    expect(r.lt).toBeCloseTo(0.053, 12);
  });
});

describe('validation and large values', () => {
  test('rejects bad input', () => {
    expect(() => taxForYear(io({ wages: 1.5 }))).toThrow(RangeError);
    expect(() => taxForYear(io({ wages: -1 }))).toThrow(RangeError);
    expect(() => taxForYear(io({ carryforward: { st: -1, lt: 0 } }))).toThrow(RangeError);
    expect(() => taxForYear(io({ year: 2026.5 }))).toThrow(RangeError);
    expect(() => taxForYear(io({ st: Number.NaN }))).toThrow(RangeError);
    expect(() => taxForYear(io({ state: { customRate: 10_001 } }))).toThrow(RangeError);
    expect(() => taxForYear(io({ state: { customRate: -1 } }))).toThrow(RangeError);
    expect(() => taxForYear(io({ state: { customRate: 5.5 } }))).toThrow(RangeError);
    expect(() => taxForYear(io({ state: { code: 'ZZ' as StateCode } }))).toThrow(RangeError);
  });

  test('values near 2^53 cents compute exactly without overflow', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const r = taxForYear(io({ wages: max, state: { customRate: 0 } }));
    // 37% of everything above the top, plus the published $206,583.50 at the top.
    const exact = 206_583_50n * 10_000n + (BigInt(max) - 32_200_00n - 768_700_00n) * 3_700n;
    expect(r.federal).toBe(Number((exact * 2n + 10_000n) / 20_000n));
    const big = taxForYear(io({ wages: 0, lt: max, state: { code: 'ID' } }));
    expect(Number.isSafeInteger(big.total)).toBe(true);
    expect(big.netting.preferential).toBe(max - 32_200_00);
  });

  test('results that do not fit a safe integer are refused', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(() => taxForYear(io({ wages: max, st: max, state: { customRate: 10_000 } }))).toThrow(/too large/);
    expect(() => taxForYear(io({ st: -max, carryforward: { st: max, lt: 0 } }))).toThrow(/too large/);
  });
});

describe('properties', () => {
  const input = fc.record({
    year: fc.constantFrom(2025, 2026, 2027),
    filingStatus: fc.constantFrom<TaxFilingStatus>('single', 'married-joint', 'married-separate', 'head-of-household', 'qualifying-surviving-spouse'),
    wages: fc.integer({ min: 0, max: 1_500_000_00 }),
    st: fc.integer({ min: -200_000_00, max: 500_000_00 }),
    lt: fc.integer({ min: -200_000_00, max: 900_000_00 }),
    carryforward: fc.record({ st: fc.integer({ min: 0, max: 50_000_00 }), lt: fc.integer({ min: 0, max: 50_000_00 }) }),
    state: fc.constantFrom<TaxInput['state']>({ code: 'ID' }, { code: 'TX' }, { customRate: 1 }, { customRate: 1333 }),
  });

  test('total is within a cent of federal + state; losses never carry more than came in', () => {
    fc.assert(
      fc.property(input, (i) => {
        const r = taxForYear(i);
        expect(Math.abs(r.total - r.federal - r.state)).toBeLessThanOrEqual(1);
        const lossIn = Math.max(0, -i.st) + Math.max(0, -i.lt) + i.carryforward.st + i.carryforward.lt;
        expect(r.carryforwardOut.st + r.carryforwardOut.lt + r.netting.lossDeduction).toBeLessThanOrEqual(lossIn);
        // Conservation: in a net-loss year, carried + deducted = the net loss.
        if (r.netting.net < 0) expect(r.carryforwardOut.st + r.carryforwardOut.lt + r.netting.lossDeduction).toBe(-r.netting.net);
        else expect(r.carryforwardOut).toEqual({ st: 0, lt: 0 });
      }),
      { numRuns: 3000 },
    );
  });

  test('incremental tax against itself is zero; capital tax effect with no capital items is zero', () => {
    fc.assert(
      fc.property(input, (i) => {
        expect(incrementalTax(i, i)).toMatchObject({ federal: 0, state: 0, total: 0 });
        expect(capitalTaxEffect({ ...i, st: 0, lt: 0, carryforward: { st: 0, lt: 0 } })).toMatchObject({ federal: 0, state: 0, total: 0 });
      }),
      { numRuns: 500 },
    );
  });

  test('more gain never lowers this year’s tax', () => {
    fc.assert(
      fc.property(input, fc.integer({ min: 0, max: 100_000_00 }), fc.boolean(), (i, extra, short) => {
        const more = short ? { ...i, st: i.st + extra } : { ...i, lt: i.lt + extra };
        expect(incrementalTax(i, more).total).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 1000 },
    );
  });
});
