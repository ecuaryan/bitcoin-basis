/** Public API of the Bitcoin Basis calculation engine. */
export const ENGINE_VERSION = 1;

export * from './types.ts';
export { divRoundHalfUp, mulDivRoundHalfUp, splitProportional, SATS_PER_BTC, type Cents, type Sats } from './money.ts';
export { ok, err } from './result.ts';
export { dateOfDay, dayNumber, latestMonthDay, DEFAULT_TIME_ZONE, isLongTerm, isValidInstant, isValidLocalDate, isValidTimeZone, localDate, oneYearAnniversary, taxYear, yearOf } from './dates.ts';
export { createUuidV7, isUuidV7, uuidv7, type UuidV7Options } from './uuidv7.ts';
export { formatBtc, formatCents, parseBtc, parseDollars } from './format.ts';
export { parseEntry } from './validate.ts';
export { replay, DEFAULT_SETTINGS, APPRAISAL_THRESHOLD_CENTS } from './replay.ts';
export { lowestTaxOrder, oldestFirst, oldestFirstOrder, picksAfterMove, picksFor, splitCost, splitMovePicks, takeInOrder, termFor, validatePicks, type LowestTaxOptions } from './picks.ts';
export { averageCostPerBtc, giftsOverExclusion, giftTotalsByRecipient, holdings, yearSummary, type Holdings, type RecipientTotal, type RetirementHolding, type WalletHolding, type YearSummary } from './reports.ts';
export { canSellFrom, type SellRefusal } from './sell-guard.ts';
export { originLotId, traceCoins, type GoneKind, type GonePiece, type TracedCoins } from './trace.ts';
export {
  aprOn,
  estimateLoanInterest,
  formatAprPercent,
  LOAN_INTEREST_CPA_NOTE,
  loanByPurchase,
  loanInterestByYear,
  loanPurchases,
  loanSummary,
  parseAprPercent,
  splitByWeights,
  suggestLoanPayment,
  type LoanInterestYear,
  type LoanPurchase,
  type LoanStatementCheck,
  type LoanSummary,
  type PaymentSuggestion,
} from './loans.ts';
export * from './tax/index.ts';
export { parseCsv, toCsv } from './csv.ts';
export {
  ENTRIES_FORMAT,
  ENTRIES_FORMAT_VERSION,
  exportEntriesJson,
  exportOpeningLotsCsv,
  form8949Csv,
  FORM_8949_COLUMNS,
  importEntriesJson,
  importOpeningLotsCsv,
  INCOME_COLUMNS,
  incomeCsv,
  OPENING_LOT_COLUMNS,
  OPENING_LOT_FUNDED_BY_COLUMN,
  type CsvProblem,
  type JsonImportProblem,
  type OpeningLotsExport,
  type OpeningLotsImport,
  type OpeningLotsImportOptions,
} from './io.ts';
export * from './planner/index.ts';
