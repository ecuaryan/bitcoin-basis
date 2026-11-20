/**
 * State rates applied to net capital gain. Only states with one flat rate, or no tax on capital gains, are
 * listed; anywhere else the user enters a custom rate. Rates are whole 1/10000ths (530 = 5.3%).
 *
 * Simplifications (shown to the user as assumptions): state rate only (no local/county income taxes),
 * assumes wages already exceed any zero-rate amount, ignores state-specific capital gain exclusions.
 */

const TAX_FOUNDATION_2026 = 'https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/';

export interface StateRate {
  readonly code: string;
  readonly name: string;
  readonly kind: 'flat' | 'none';
  readonly rate: number;
  /** Tax year the rate was sourced for. */
  readonly year: number;
  readonly source: string;
  readonly note?: string;
}

const withNote = (note: string | undefined): { note?: string } => (note === undefined ? {} : { note });

const flat = (code: string, name: string, rate: number, source: string, note?: string): StateRate =>
  ({ code, name, kind: 'flat', rate, year: 2026, source, ...withNote(note) });

const none = (code: string, name: string, note?: string): StateRate =>
  ({ code, name, kind: 'none', rate: 0, year: 2026, source: TAX_FOUNDATION_2026, ...withNote(note) });

export const STATE_RATES = {
  AK: none('AK', 'Alaska'),
  AZ: flat('AZ', 'Arizona', 250, TAX_FOUNDATION_2026),
  CO: flat('CO', 'Colorado', 440, TAX_FOUNDATION_2026, 'Can be lowered temporarily after the year when state revenue exceeds its limit.'),
  FL: none('FL', 'Florida'),
  GA: flat('GA', 'Georgia', 499, 'https://dor.georgia.gov/taxes/important-tax-updates', 'Lowered from 5.19% to 4.99% retroactive to 2026-01-01.'),
  ID: flat('ID', 'Idaho', 530, 'https://legislature.idaho.gov/statutesrules/idstat/Title63/T63CH30/SECT63-3024/'),
  IL: flat('IL', 'Illinois', 495, TAX_FOUNDATION_2026),
  IN: flat('IN', 'Indiana', 295, TAX_FOUNDATION_2026, 'County income taxes not included.'),
  IA: flat('IA', 'Iowa', 380, TAX_FOUNDATION_2026),
  KY: flat('KY', 'Kentucky', 350, TAX_FOUNDATION_2026, 'Local occupational taxes not included.'),
  LA: flat('LA', 'Louisiana', 300, TAX_FOUNDATION_2026),
  MI: flat('MI', 'Michigan', 425, TAX_FOUNDATION_2026, 'City income taxes not included.'),
  MS: flat('MS', 'Mississippi', 400, TAX_FOUNDATION_2026, 'Applies to taxable income over $10,000.'),
  NV: none('NV', 'Nevada'),
  NH: none('NH', 'New Hampshire', 'Interest and dividends tax repealed from 2025.'),
  NC: flat('NC', 'North Carolina', 399, TAX_FOUNDATION_2026),
  OH: flat('OH', 'Ohio', 275, TAX_FOUNDATION_2026, 'Flat from 2026-01-01; applies above the zero-rate amount. City income taxes not included.'),
  PA: flat('PA', 'Pennsylvania', 307, TAX_FOUNDATION_2026, 'Local earned income taxes not included.'),
  SD: none('SD', 'South Dakota'),
  TN: none('TN', 'Tennessee'),
  TX: none('TX', 'Texas'),
  UT: flat('UT', 'Utah', 445, 'https://le.utah.gov/Session/2026/bills/enrolled/SB0060.pdf', 'S.B. 60 lowered the rate from 4.5% to 4.45% retroactive to 2026-01-01.'),
  WY: none('WY', 'Wyoming'),
} as const satisfies Record<string, StateRate>;

export type StateCode = keyof typeof STATE_RATES;
