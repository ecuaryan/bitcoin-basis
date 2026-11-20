/** Shared types for the tax module. Money is whole cents; rates are whole 1/10000ths (530 = 5.3%). */

import type { Cents } from '../money.ts';

export type TaxFilingStatus = 'single' | 'married-joint' | 'married-separate' | 'head-of-household' | 'qualifying-surviving-spouse';

export const TAX_FILING_STATUSES: readonly TaxFilingStatus[] = ['single', 'married-joint', 'married-separate', 'head-of-household', 'qualifying-surviving-spouse'];

/** A rate in whole 1/10000ths: 1000 = 10%, 380 = 3.8%. */
export type TaxRate = number;

export const RATE_SCALE = 10_000;

/** One ordinary bracket: `rate` applies to taxable income up to `upTo` cents (null = no top). */
export interface Bracket {
  readonly upTo: Cents | null;
  readonly rate: TaxRate;
}

export interface TableSource {
  readonly title: string;
  readonly url: string;
}

export interface FederalTable {
  readonly year: number;
  readonly sources: readonly TableSource[];
  readonly ordinary: Readonly<Record<TaxFilingStatus, readonly Bracket[]>>;
  readonly standardDeduction: Readonly<Record<TaxFilingStatus, Cents>>;
  /** Long-term capital gains: 0% up to `zeroTop`, 15% up to `fifteenTop`, 20% above (taxable income, cents). */
  readonly longTerm: Readonly<Record<TaxFilingStatus, { readonly zeroTop: Cents; readonly fifteenTop: Cents }>>;
  /** Net investment income tax (3.8%) MAGI thresholds, cents. Statutory, not indexed. */
  readonly niitThreshold: Readonly<Record<TaxFilingStatus, Cents>>;
  /** Capital loss deductible against ordinary income per year, cents (IRC § 1211(b)). */
  readonly capitalLossLimit: Readonly<Record<TaxFilingStatus, Cents>>;
  /** Gift tax annual exclusion per recipient, cents. */
  readonly giftAnnualExclusion: Cents;
}
