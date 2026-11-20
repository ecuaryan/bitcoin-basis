/** Amounts fixed in the Internal Revenue Code (not inflation-adjusted), shared by every year table. */

import type { Bracket, TaxFilingStatus, TableSource } from '../types.ts';

/** IRC § 1411(b): $250,000 joint or surviving spouse, $125,000 married filing separately, $200,000 otherwise. */
export const NIIT_THRESHOLD: Readonly<Record<TaxFilingStatus, number>> = {
  single: 200_000_00,
  'married-joint': 250_000_00,
  'married-separate': 125_000_00,
  'head-of-household': 200_000_00,
  'qualifying-surviving-spouse': 250_000_00,
};

/** IRC § 1211(b): $3,000, or $1,500 for married filing separately. */
export const CAPITAL_LOSS_LIMIT: Readonly<Record<TaxFilingStatus, number>> = {
  single: 3_000_00,
  'married-joint': 3_000_00,
  'married-separate': 1_500_00,
  'head-of-household': 3_000_00,
  'qualifying-surviving-spouse': 3_000_00,
};

export const NIIT_RATE = 380;

export const STATUTORY_SOURCES: readonly TableSource[] = [
  { title: 'IRC § 1411 (net investment income tax thresholds)', url: 'https://www.law.cornell.edu/uscode/text/26/1411' },
  { title: 'IRC § 1211(b) (capital loss limit)', url: 'https://www.law.cornell.edu/uscode/text/26/1211' },
  { title: 'IRC § 1212(b) (capital loss carryover character)', url: 'https://www.law.cornell.edu/uscode/text/26/1212' },
];

/** Ordinary rates under IRC § 1(j)(2) as made permanent by Pub. L. 119-21: 10, 12, 22, 24, 32, 35, 37%. */
export const ORDINARY_RATES: readonly number[] = [1000, 1200, 2200, 2400, 3200, 3500, 3700];

/** Build the seven ordinary brackets from the six published bracket tops (cents). */
export function brackets(tops: readonly [number, number, number, number, number, number]): Bracket[] {
  return ORDINARY_RATES.map((rate, i) => ({ upTo: tops[i] ?? null, rate }));
}
