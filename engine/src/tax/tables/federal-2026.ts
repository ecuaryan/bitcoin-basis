/**
 * Federal figures for tax year 2026, from Rev. Proc. 2025-32 (which reflects Pub. L. 119-21, the 2025
 * reconciliation law): § 4.01 rate tables, § 4.03 capital gains rate amounts, § 4.14 standard deduction,
 * § 4.42 gift annual exclusion. Qualifying surviving spouse uses the joint figures (Rev. Proc. tables list
 * "Married Individuals Filing Joint Returns and Surviving Spouses"). Amounts in cents.
 */

import type { FederalTable } from '../types.ts';
import { brackets, CAPITAL_LOSS_LIMIT, NIIT_THRESHOLD, STATUTORY_SOURCES } from './statutory.ts';

const joint = brackets([24_800_00, 100_800_00, 211_400_00, 403_550_00, 512_450_00, 768_700_00]);

export const FEDERAL_2026: FederalTable = {
  year: 2026,
  sources: [
    { title: 'Rev. Proc. 2025-32', url: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf' },
    ...STATUTORY_SOURCES,
  ],
  ordinary: {
    'married-joint': joint,
    'qualifying-surviving-spouse': joint,
    'head-of-household': brackets([17_700_00, 67_450_00, 105_700_00, 201_750_00, 256_200_00, 640_600_00]),
    single: brackets([12_400_00, 50_400_00, 105_700_00, 201_775_00, 256_225_00, 640_600_00]),
    'married-separate': brackets([12_400_00, 50_400_00, 105_700_00, 201_775_00, 256_225_00, 384_350_00]),
  },
  standardDeduction: { 'married-joint': 32_200_00, 'qualifying-surviving-spouse': 32_200_00, 'head-of-household': 24_150_00, single: 16_100_00, 'married-separate': 16_100_00 },
  longTerm: {
    'married-joint': { zeroTop: 98_900_00, fifteenTop: 613_700_00 },
    'qualifying-surviving-spouse': { zeroTop: 98_900_00, fifteenTop: 613_700_00 },
    'married-separate': { zeroTop: 49_450_00, fifteenTop: 306_850_00 },
    'head-of-household': { zeroTop: 66_200_00, fifteenTop: 579_600_00 },
    single: { zeroTop: 49_450_00, fifteenTop: 545_500_00 },
  },
  niitThreshold: NIIT_THRESHOLD,
  capitalLossLimit: CAPITAL_LOSS_LIMIT,
  giftAnnualExclusion: 19_000_00,
};
