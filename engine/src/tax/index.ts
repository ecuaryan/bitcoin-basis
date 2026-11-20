export { capitalTaxEffect, incrementalTax, marginalRates, taxForYear } from './tax.ts';
export type { Carryforward, IncrementalTax, MarginalRates, Netting, StateChoice, TaxAssumptions, TaxEffect, TaxInput, TaxResult } from './tax.ts';
export { FEDERAL_TABLES, federalTableFor } from './tables/index.ts';
export type { TableLookup } from './tables/index.ts';
export { STATE_RATES } from './tables/state.ts';
export type { StateCode, StateRate } from './tables/state.ts';
export { TAX_FILING_STATUSES, RATE_SCALE } from './types.ts';
export type { Bracket, FederalTable, TaxFilingStatus, TaxRate, TableSource } from './types.ts';
