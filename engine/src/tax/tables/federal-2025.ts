/**
 * Federal figures for tax year 2025, from Rev. Proc. 2024-40: § 2.01 rate tables, § 2.03 capital gains
 * rate amounts, § 2.43 gift annual exclusion. The standard deduction is NOT the § 2.15 amount: Pub. L. 119-21
 * raised it for 2025, and Rev. Proc. 2025-32 § 3.01 removed § 2.15(1) of Rev. Proc. 2024-40 and gives the
 * 2025 amounts used here ($31,500 joint / $23,625 head of household / $15,750 single and separate).
 * Qualifying surviving spouse uses the joint figures. Amounts in cents.
 */

import type { FederalTable } from '../types.ts';
import { brackets, CAPITAL_LOSS_LIMIT, NIIT_THRESHOLD, STATUTORY_SOURCES } from './statutory.ts';

const joint = brackets([23_850_00, 96_950_00, 206_700_00, 394_600_00, 501_050_00, 751_600_00]);

export const FEDERAL_2025: FederalTable = {
  year: 2025,
  sources: [
    { title: 'Rev. Proc. 2024-40', url: 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf' },
    { title: 'Rev. Proc. 2025-32 § 3.01 (2025 standard deduction after Pub. L. 119-21)', url: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf' },
    ...STATUTORY_SOURCES,
  ],
  ordinary: {
    'married-joint': joint,
    'qualifying-surviving-spouse': joint,
    'head-of-household': brackets([17_000_00, 64_850_00, 103_350_00, 197_300_00, 250_500_00, 626_350_00]),
    single: brackets([11_925_00, 48_475_00, 103_350_00, 197_300_00, 250_525_00, 626_350_00]),
    'married-separate': brackets([11_925_00, 48_475_00, 103_350_00, 197_300_00, 250_525_00, 375_800_00]),
  },
  standardDeduction: { 'married-joint': 31_500_00, 'qualifying-surviving-spouse': 31_500_00, 'head-of-household': 23_625_00, single: 15_750_00, 'married-separate': 15_750_00 },
  longTerm: {
    'married-joint': { zeroTop: 96_700_00, fifteenTop: 600_050_00 },
    'qualifying-surviving-spouse': { zeroTop: 96_700_00, fifteenTop: 600_050_00 },
    'married-separate': { zeroTop: 48_350_00, fifteenTop: 300_000_00 },
    'head-of-household': { zeroTop: 64_750_00, fifteenTop: 566_700_00 },
    single: { zeroTop: 48_350_00, fifteenTop: 533_400_00 },
  },
  niitThreshold: NIIT_THRESHOLD,
  capitalLossLimit: CAPITAL_LOSS_LIMIT,
  giftAnnualExclusion: 19_000_00,
};
