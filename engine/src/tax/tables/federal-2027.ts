/**
 * Federal figures for tax year 2027, from Rev. Proc. 2026-35 (released 2026-11-05): § 3.01 rate tables,
 * § 3.03 capital gains rate amounts, § 3.15 standard deduction, § 3.46 gift annual exclusion.
 * Qualifying surviving spouse uses the joint figures. Amounts in cents.
 */

import type { FederalTable } from '../types.ts';
import { brackets, CAPITAL_LOSS_LIMIT, NIIT_THRESHOLD, STATUTORY_SOURCES } from './statutory.ts';

const joint = brackets([25_600_00, 104_050_00, 218_250_00, 416_650_00, 529_100_00, 793_650_00]);

export const FEDERAL_2027: FederalTable = {
  year: 2027,
  sources: [
    { title: 'Rev. Proc. 2026-35', url: 'https://www.irs.gov/pub/irs-drop/rp-26-35.pdf' },
    ...STATUTORY_SOURCES,
  ],
  ordinary: {
    'married-joint': joint,
    'qualifying-surviving-spouse': joint,
    'head-of-household': brackets([18_250_00, 69_650_00, 109_100_00, 208_300_00, 264_550_00, 661_350_00]),
    single: brackets([12_800_00, 52_025_00, 109_125_00, 208_325_00, 264_550_00, 661_375_00]),
    'married-separate': brackets([12_800_00, 52_025_00, 109_125_00, 208_325_00, 264_550_00, 396_825_00]),
  },
  standardDeduction: { 'married-joint': 33_200_00, 'qualifying-surviving-spouse': 33_200_00, 'head-of-household': 24_925_00, single: 16_600_00, 'married-separate': 16_600_00 },
  longTerm: {
    'married-joint': { zeroTop: 102_100_00, fifteenTop: 633_600_00 },
    'qualifying-surviving-spouse': { zeroTop: 102_100_00, fifteenTop: 633_600_00 },
    'married-separate': { zeroTop: 51_050_00, fifteenTop: 316_800_00 },
    'head-of-household': { zeroTop: 68_350_00, fifteenTop: 598_400_00 },
    single: { zeroTop: 51_050_00, fifteenTop: 563_200_00 },
  },
  niitThreshold: NIIT_THRESHOLD,
  capitalLossLimit: CAPITAL_LOSS_LIMIT,
  giftAnnualExclusion: 20_000_00,
};
