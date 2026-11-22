/**
 * The gift tax annual exclusion (IRC § 2503(b)) for years before the earliest full federal table, from each
 * year's Rev. Proc. (2009–2012 $13,000; 2013–2017 $14,000, Rev. Proc. 2016-55 § 3.37 for 2017; 2018–2021
 * $15,000; 2022 $16,000, Rev. Proc. 2021-45; 2023 $17,000, Rev. Proc. 2022-38; 2024 $18,000, Rev. Proc.
 * 2023-34). Years with a full table use the table's figure. Amounts in cents.
 */
export const EARLIER_GIFT_EXCLUSIONS: Readonly<Record<number, number>> = {
  2009: 13_000_00,
  2010: 13_000_00,
  2011: 13_000_00,
  2012: 13_000_00,
  2013: 14_000_00,
  2014: 14_000_00,
  2015: 14_000_00,
  2016: 14_000_00,
  2017: 14_000_00,
  2018: 15_000_00,
  2019: 15_000_00,
  2020: 15_000_00,
  2021: 15_000_00,
  2022: 16_000_00,
  2023: 17_000_00,
  2024: 18_000_00,
};

/** The exclusion for an early `year` (before Bitcoin, 2009's). */
export function earlierGiftExclusion(year: number): number {
  return EARLIER_GIFT_EXCLUSIONS[Math.max(2009, year)] as number;
}
