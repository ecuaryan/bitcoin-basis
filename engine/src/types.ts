/**
 * Core types for the ledger: entries (the only stored data), wallets, lots, settings,
 * the replayed ledger state and typed error results. See docs/engine-spec.md.
 */
import type { Cents, Sats } from './money.ts';

/** `{ ok: true, value }` or `{ ok: false, error }`. Used instead of exceptions for user-caused problems. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Letters, digits, `_` and `-`, 1 to 64 characters (a UUIDv7 in practice). Never contains `:`. */
export type EntryId = string;
export type WalletId = string;
/** A loan's own id (same format as an entry id), chosen when the loan is created. */
export type LoanId = string;
/**
 * The root entry id of the version chain that created the coins, or `<moveRootId>:<sourceLotId>` for the
 * piece of a lot moved by a move (e.g. `M2:M1:L1` for coins moved twice).
 */
export type LotId = string;
/** ISO-8601 UTC instant, e.g. `2026-01-01T06:30:00Z` (optional `.sss` milliseconds). */
export type IsoInstant = string;
/** Calendar date `YYYY-MM-DD` in the entry's time zone. */
export type LocalDate = string;

export type WalletType = 'exchange' | 'self-custody' | 'retirement';
export const WALLET_TYPES: readonly WalletType[] = ['exchange', 'self-custody', 'retirement'];

/** How well a lot's cost is documented, best first. */
export type Tier = 'documented' | 'reconstructed' | 'estimated' | 'unknown';
export const TIERS: readonly Tier[] = ['documented', 'reconstructed', 'estimated', 'unknown'];

export type Term = 'short' | 'long';
export type LostCause = 'lost-keys' | 'wrong-address' | 'hack' | 'scam';
export const LOST_CAUSES: readonly LostCause[] = ['lost-keys', 'wrong-address', 'hack', 'scam'];

/** The one filing-status type, shared by the ledger settings and the tax module. */
export type FilingStatus = 'single' | 'married-joint' | 'married-separate' | 'head-of-household' | 'qualifying-surviving-spouse';
export const FILING_STATUSES: readonly FilingStatus[] = ['single', 'married-joint', 'married-separate', 'head-of-household', 'qualifying-surviving-spouse'];

/** Sats taken from one lot by a disposal. */
export interface LotPick {
  readonly lotId: LotId;
  readonly sats: Sats;
}

// ---------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------

interface EntryBase<K extends string> {
  readonly id: EntryId;
  readonly kind: K;
  readonly at: IsoInstant;
  /** IANA time zone deciding the entry's local date (default `America/Boise`). */
  readonly tz: string;
  readonly note?: string;
  readonly proof?: string;
  /** Id of the entry this one edits (or deletes, for `delete`). */
  readonly replaces?: EntryId;
  /** Required with `replaces`; also the free-text reason of a close-out or unlock. */
  readonly reason?: string;
}

export interface WalletEntry extends EntryBase<'wallet'> {
  readonly wallet: WalletId;
  readonly name: string;
  readonly type: WalletType;
  readonly defaultProof: string;
}
export interface WalletUpdateEntry extends EntryBase<'wallet-update'> {
  readonly wallet: WalletId;
  readonly name?: string;
  readonly archived?: boolean;
}
export interface WalletFreezeEntry extends EntryBase<'wallet-freeze'> {
  readonly wallet: WalletId;
}
export interface WalletCloseOutEntry extends EntryBase<'wallet-close-out'> {
  readonly wallet: WalletId;
  /** Tax date of the loss; defaults to the entry's own local date. */
  readonly lossDate?: LocalDate;
  readonly reason: string;
}
export interface OpeningLotEntry extends EntryBase<'opening-lot'> {
  readonly wallet: WalletId;
  readonly acquiredAt: IsoInstant;
  readonly sats: Sats;
  readonly costCents: Cents;
  readonly tier: Tier;
  /** Where the record is; becomes the lot's proof. */
  readonly origin: string;
}
export interface BuyEntry extends EntryBase<'buy'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
  /** Total paid including fees. */
  readonly costCents: Cents;
  readonly tier: Tier;
}

export type ReceiveSource =
  | { readonly type: 'income'; readonly description?: string }
  | { readonly type: 'gift'; readonly giverCostCents?: Cents; readonly giverAcquiredAt?: IsoInstant }
  | { readonly type: 'inherited' }
  | { readonly type: 'frozen-payout'; readonly fromWallet: WalletId };

export interface ReceiveEntry extends EntryBase<'receive'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
  /** Value when received. */
  readonly valueCents: Cents;
  readonly source: ReceiveSource;
  /** Defaults to `documented` (`unknown` for a gift whose giver's cost is unknown). */
  readonly tier?: Tier;
}
export interface MoveEntry extends EntryBase<'move'> {
  readonly from: WalletId;
  readonly to: WalletId;
  /** Sats arriving in `to`. */
  readonly sats: Sats;
  readonly feeSats: Sats;
  readonly feeValueCents: Cents;
  /** Sum to `sats + feeSats`; moved sats are taken first, then the fee, in pick order. */
  readonly picks: readonly LotPick[];
}
export interface SellEntry extends EntryBase<'sell'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
  readonly proceedsCents: Cents;
  readonly picks: readonly LotPick[];
  /** True when the coins paid for something. */
  readonly spent: boolean;
  readonly description?: string;
}
export interface GiveEntry extends EntryBase<'give'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
  readonly valueCents: Cents;
  readonly to: 'person' | 'charity';
  readonly recipient: string;
  readonly picks: readonly LotPick[];
}
export interface LostEntry extends EntryBase<'lost'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
  readonly cause: LostCause;
  readonly picks: readonly LotPick[];
}
export interface BalanceConfirmEntry extends EntryBase<'balance-confirm'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
}
export interface RetirementSnapshotEntry extends EntryBase<'retirement-snapshot'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
}
/**
 * Coins bought inside a retirement wallet (an IRA). Recorded for cost and gain only: never a lot, never in any tax
 * figure, average cost of the taxable book, the planner or loans. `at` is when it was bought; `proof` says where the
 * record is (an imported row's `origin`).
 */
export interface RetirementBuyEntry extends EntryBase<'retirement-buy'> {
  readonly wallet: WalletId;
  readonly sats: Sats;
  /** Total paid including fees. */
  readonly costCents: Cents;
}
export interface SettingsEntry extends EntryBase<'settings'> {
  readonly patch: SettingsPatch;
}
export interface CloseYearEntry extends EntryBase<'close-year'> {
  readonly year: number;
}
export interface UnlockYearEntry extends EntryBase<'unlock-year'> {
  readonly year: number;
  readonly reason: string;
}
/** Written by older versions (the retired giving feature). Still accepted, so old records replay, and ignored. */
export interface GivingPaidEntry extends EntryBase<'giving-paid'> {
  readonly year: number;
  readonly cents: Cents;
}
// Loans (docs/loans-spec.md). Tracking only: they never change lots, cost basis or gains.

/** How the lender turns an APR into a daily rate: APR ÷ 365 (most HELOCs) or APR ÷ 360. */
export type DayCount = 'actual/365' | 'actual/360';
export const DAY_COUNTS: readonly DayCount[] = ['actual/365', 'actual/360'];

/**
 * A line of credit or loan that paid for some purchases (e.g. a HELOC). `aprMillionths` is the APR as a whole
 * number of millionths: 65_000 = 6.5%, 78_750 = 7.875% (prime + margin in eighths of a percent stays exact).
 */
export interface LoanEntry extends EntryBase<'loan'> {
  readonly loan: LoanId;
  readonly name: string;
  /** First day of the loan (the rate in force from then is `aprMillionths`). */
  readonly opened: LocalDate;
  readonly aprMillionths: number;
  /** Default `actual/365`. */
  readonly dayCount?: DayCount;
  readonly creditLimitCents?: Cents;
  /** Day of the month each billing cycle ends (statement closing date), 1-31; 31 means the month's last day. */
  readonly statementDay?: number;
}
/**
 * Rename, change the credit limit, close/reopen, record a rate change from `rateFrom`, or change the statement day
 * (from this record's own date on; earlier payments keep the day in force when they were made).
 */
export interface LoanUpdateEntry extends EntryBase<'loan-update'> {
  readonly loan: LoanId;
  readonly name?: string;
  readonly creditLimitCents?: Cents;
  readonly statementDay?: number;
  readonly closed?: boolean;
  readonly aprMillionths?: number;
  /** First day the new rate applies (default: this entry's local date). Only with `aprMillionths`. */
  readonly rateFrom?: LocalDate;
}
/** Money drawn that did not pay for a tracked purchase (so what is owed stays true). Dated by `at`. */
export interface LoanDrawEntry extends EntryBase<'loan-draw'> {
  readonly loan: LoanId;
  readonly cents: Cents;
}
/**
 * This purchase (a buy or opening lot, named by its lot id: the root id of the entry that created it) was paid
 * with money drawn from `loan`. The draw is the purchase's cost on its acquired date unless given. Unlink by
 * deleting this entry. A purchase belongs to at most one loan.
 */
export interface LoanLinkEntry extends EntryBase<'loan-link'> {
  readonly loan: LoanId;
  readonly lot: LotId;
  /** Other lots holding the same purchase's coins (an import that split one purchase across rows). */
  readonly alsoLots?: readonly LotId[];
  readonly drawCents?: Cents;
  readonly drawDate?: LocalDate;
}
/**
 * A payment, dated by `at`: the interest part and the principal part (total = both). Also records "interest
 * paid so far" when tracking starts (principal 0). `interestThrough` is the last day the interest covers
 * (default: the latest statement closing date on or before the payment, else the payment date).
 */
export interface LoanPaymentEntry extends EntryBase<'loan-payment'> {
  readonly loan: LoanId;
  readonly interestCents: Cents;
  readonly principalCents: Cents;
  readonly interestThrough?: LocalDate;
}
/** The principal balance the lender's statement shows on its date (`at`), to check against the records. */
export interface LoanStatementEntry extends EntryBase<'loan-statement'> {
  readonly loan: LoanId;
  readonly balanceCents: Cents;
}

export interface DeleteEntry extends EntryBase<'delete'> {
  readonly replaces: EntryId;
  readonly reason: string;
}

export type Entry =
  | WalletEntry
  | WalletUpdateEntry
  | WalletFreezeEntry
  | WalletCloseOutEntry
  | OpeningLotEntry
  | BuyEntry
  | ReceiveEntry
  | MoveEntry
  | SellEntry
  | GiveEntry
  | LostEntry
  | BalanceConfirmEntry
  | RetirementSnapshotEntry
  | RetirementBuyEntry
  | SettingsEntry
  | CloseYearEntry
  | UnlockYearEntry
  | GivingPaidEntry
  | LoanEntry
  | LoanUpdateEntry
  | LoanDrawEntry
  | LoanLinkEntry
  | LoanPaymentEntry
  | LoanStatementEntry
  | DeleteEntry;

export type EntryKind = Entry['kind'];

/** Records that only track a loan; they never change lots, cost basis or gains. */
export type LoanRecordEntry = LoanEntry | LoanUpdateEntry | LoanDrawEntry | LoanLinkEntry | LoanPaymentEntry | LoanStatementEntry;
/** Every other entry: the ones that make up the coin ledger. */
export type CoinEntry = Exclude<Entry, LoanRecordEntry>;

/** Entry kinds that only track a loan; they never change lots, cost basis or gains. */
export const LOAN_KINDS: readonly LoanRecordEntry['kind'][] = ['loan', 'loan-update', 'loan-draw', 'loan-link', 'loan-payment', 'loan-statement'];

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/**
 * State income tax: none, a state's flat rate from the tax tables, or a custom flat rate as a whole number of 1/10000ths
 * (530 = 5.3%). A custom rate may name the state it is for (a state with graduated rates, where the person enters their
 * own effective rate); the name is only for showing, the rate is what counts.
 */
export type StateTaxSetting =
  | { readonly kind: 'none' }
  | { readonly kind: 'flat'; readonly state: string }
  | { readonly kind: 'custom'; readonly rate: number; readonly state?: string };

export interface Settings {
  readonly filingStatus: FilingStatus;
  readonly wagesCents: Cents;
  readonly state: StateTaxSetting;
  /** The latest losses from past years saved (positive cents) and the year they are for; also kept in `carryforwardByYear`. */
  readonly carryforwardStCents: Cents;
  readonly carryforwardLtCents: Cents;
  /** The tax year those losses are for. In entries written before it existed, replay uses the entry's own year. */
  readonly carryforwardYear?: number;
  /**
   * Losses from past years per tax year they apply to (`"2026": { st, lt }`, positive cents). A settings patch writes only
   * the years it names, so saving next year's figure never changes an earlier year's.
   */
  readonly carryforwardByYear: Readonly<Record<string, CarryforwardAmounts>>;
  /** Default time zone for new entries. */
  readonly timeZone: string;
}
/**
 * Settings older versions wrote (the giving feature and "dollars you put in before using this app"). Still accepted in
 * a settings entry, so old records and backups replay, and ignored.
 */
export interface RetiredSettings {
  readonly givingEnabled?: boolean;
  readonly givingName?: string;
  readonly givingPercentBp?: number;
  readonly givingMode?: 'before-tax' | 'after-tax';
  readonly earlierMoneyInCents?: Cents;
}
export const RETIRED_SETTINGS: readonly (keyof RetiredSettings)[] = ['givingEnabled', 'givingName', 'givingPercentBp', 'givingMode', 'earlierMoneyInCents'];
export type SettingsPatch = Partial<Settings> & RetiredSettings;
export interface CarryforwardAmounts {
  readonly st: Cents;
  readonly lt: Cents;
}

// ---------------------------------------------------------------------------------------------
// Ledger state (output of replay)
// ---------------------------------------------------------------------------------------------

export interface Wallet {
  id: WalletId;
  name: string;
  type: WalletType;
  defaultProof: string;
  archived: boolean;
  frozen: boolean;
  /** Set once a `wallet-close-out` has emptied the wallet. */
  closeOutEntryId: EntryId | null;
  /** Frozen-payout value that reduces the close-out loss: payouts dated on or before the loss date (all payouts so far if not closed out). */
  recoveredCents: Cents;
}

export interface Lot {
  id: LotId;
  wallet: WalletId;
  sats: Sats;
  costCents: Cents;
  acquiredDate: LocalDate;
  acquiredAt: IsoInstant;
  tier: Tier;
  proof: string;
  /** The buy/receive/opening-lot entry that first created these coins. */
  originEntryId: EntryId;
  /** Inherited coins are always long-term. */
  alwaysLongTerm: boolean;
  /** Time zone of the entry that created the coins (decides `acquiredDate`). */
  tz: string;
  /**
   * A gift received worth less than the giver's cost (Treas. Reg. 1.1015-1(a)): the value at the gift and
   * the gift date, used instead of the giver's cost and date when a disposal is at a loss. Null otherwise.
   */
  lossBasis: LossBasis | null;
}

export interface LossBasis {
  costCents: Cents;
  acquiredDate: LocalDate;
}

/** One lot's share of a disposal, gift or loss. */
export interface PickDetail {
  lotId: LotId;
  sats: Sats;
  costCents: Cents;
  acquiredDate: LocalDate;
  tier: Tier;
  term: Term;
  /** Inherited coins (Form 8949 shows "INHERITED" as the date acquired). */
  inherited: boolean;
}
export interface DisposalPick extends PickDetail {
  proceedsCents: Cents;
  gainCents: Cents;
}

/** A taxable disposal: a sale, spending, or a network fee paid in BTC. */
export interface Disposal {
  entryId: EntryId;
  kind: 'sell' | 'spend' | 'fee';
  wallet: WalletId;
  at: IsoInstant;
  date: LocalDate;
  year: number;
  sats: Sats;
  proceedsCents: Cents;
  costCents: Cents;
  gainCents: Cents;
  stGainCents: Cents;
  ltGainCents: Cents;
  picks: DisposalPick[];
  description: string | null;
}

export interface IncomeItem {
  entryId: EntryId;
  wallet: WalletId;
  date: LocalDate;
  year: number;
  sats: Sats;
  valueCents: Cents;
  description: string | null;
}

export interface GiftReceived {
  entryId: EntryId;
  wallet: WalletId;
  date: LocalDate;
  year: number;
  sats: Sats;
  valueCents: Cents;
  /** Carried-over cost (0 if unknown). */
  costCents: Cents;
  costKnown: boolean;
  acquiredDate: LocalDate;
  /** Value at the gift was below the giver's cost: "dual basis: confirm with your CPA". */
  dualBasis: boolean;
}

export interface GiftPick extends PickDetail {
  valueCents: Cents;
}
export interface GiftGiven {
  entryId: EntryId;
  wallet: WalletId;
  recipient: string;
  date: LocalDate;
  year: number;
  sats: Sats;
  valueCents: Cents;
  /** Recipient's carried-over cost; each pick keeps its acquired date. */
  costCents: Cents;
  picks: GiftPick[];
}
export interface CharityGift extends GiftGiven {
  /** CPA note: value for long-term picks, lesser of cost and value for short-term picks. */
  deductionCents: Cents;
  /** Charity gifts that year are worth over $5,000 in total: qualified appraisal needed. */
  appraisalFlag: boolean;
}

export interface LostRecord {
  entryId: EntryId;
  wallet: WalletId;
  cause: LostCause;
  date: LocalDate;
  year: number;
  sats: Sats;
  costCents: Cents;
  picks: PickDetail[];
}

export interface CloseOutPiece extends PickDetail {
  recoveredCents: Cents;
  gainCents: Cents;
}
/** Loss on a frozen platform: cost of its lots − everything recovered before close-out. */
export interface CloseOut {
  entryId: EntryId;
  wallet: WalletId;
  lossDate: LocalDate;
  year: number;
  sats: Sats;
  costCents: Cents;
  recoveredCents: Cents;
  gainCents: Cents;
  stGainCents: Cents;
  ltGainCents: Cents;
  /** @deprecated Later recoveries split short/long (see `Recovery`); this is the term of the larger share. */
  recoveryTerm: Term;
  pieces: CloseOutPiece[];
}
/**
 * A payout from a closed-out wallet dated after the loss date: a gain with basis $0 in the year received,
 * split short/long in proportion to the close-out's short- and long-term losses.
 */
export interface Recovery {
  entryId: EntryId;
  wallet: WalletId;
  fromWallet: WalletId;
  closeOutEntryId: EntryId;
  date: LocalDate;
  year: number;
  sats: Sats;
  gainCents: Cents;
  stGainCents: Cents;
  ltGainCents: Cents;
  /** @deprecated Use `stGainCents` / `ltGainCents`; this is the term of the larger part (long on a tie). */
  term: Term;
}

export interface BalanceCheck {
  entryId: EntryId;
  wallet: WalletId;
  date: LocalDate;
  reportedSats: Sats;
  ledgerSats: Sats;
  /** reported − ledger. */
  differenceSats: Sats;
  matches: boolean;
  /** Entries touching this wallet since the last matching confirmation (empty when it matches). */
  entriesSinceLastMatch: EntryId[];
}

export interface RetirementSnapshot {
  entryId: EntryId;
  wallet: WalletId;
  at: IsoInstant;
  date: LocalDate;
  sats: Sats;
}

/** An applied retirement purchase. Kept apart from lots: nothing in tax math reads it. */
export interface RetirementBuy {
  /** The version applied. */
  entryId: EntryId;
  /** Root of the entry's version chain: stays the same through edits. */
  id: EntryId;
  wallet: WalletId;
  at: IsoInstant;
  /** Local date of `at` in the entry's time zone. */
  date: LocalDate;
  tz: string;
  sats: Sats;
  costCents: Cents;
  /** Where the record is ('' if not given). */
  proof: string;
}

/** Two or more entries replace the same entry: none of them is applied until resolved. */
export interface Conflict {
  targetId: EntryId;
  versions: Entry[];
}

export type CpaFlagCode = 'dual-basis' | 'lost-coins' | 'qualified-appraisal';
export interface CpaFlag {
  entryId: EntryId;
  code: CpaFlagCode;
  message: string;
}

export type PickErrorCode = 'invalid-amount' | 'unknown-lot' | 'wrong-wallet' | 'duplicate-pick' | 'picks-sum-mismatch' | 'insufficient-sats';
export interface PickError {
  code: PickErrorCode;
  message: string;
  lotId?: LotId;
}

export type LedgerErrorCode =
  | PickErrorCode
  | 'invalid-entry'
  | 'duplicate-id'
  | 'closed-year'
  | 'replaces-unknown'
  | 'replace-cycle'
  | 'cannot-replace'
  | 'unknown-wallet'
  | 'wallet-exists'
  | 'wallet-frozen'
  | 'retirement-wallet'
  | 'not-retirement-wallet'
  | 'wallet-archived'
  | 'not-frozen'
  | 'already-closed-out'
  | 'nothing-to-close-out'
  | 'invalid-loss-date'
  | 'wallet-name-taken'
  | 'duplicate-lot'
  | 'out-of-range'
  | 'unknown-loan'
  | 'loan-exists'
  | 'loan-name-taken'
  | 'unknown-purchase'
  | 'already-linked';

/** An entry that could not be applied. The rest of the ledger replays without it. */
export interface LedgerError {
  entryId: EntryId;
  code: LedgerErrorCode;
  message: string;
}

export interface LedgerState {
  wallets: Wallet[];
  /** Open lots (sats > 0), in creation order. */
  lots: Lot[];
  disposals: Disposal[];
  income: IncomeItem[];
  giftsReceived: GiftReceived[];
  gifts: GiftGiven[];
  charityGifts: CharityGift[];
  lost: LostRecord[];
  closeOuts: CloseOut[];
  recoveries: Recovery[];
  balanceChecks: BalanceCheck[];
  retirementSnapshots: RetirementSnapshot[];
  /** Retirement purchases in replay order. Never part of lots, cost basis, gains or any tax figure. */
  retirementBuys: RetirementBuy[];
  conflicts: Conflict[];
  closedYears: number[];
  settings: Settings;
  cpaFlags: CpaFlag[];
  errors: LedgerError[];
  /** Ids of the entries applied, in replay order. */
  applied: EntryId[];
  /** Loans and their records (tracking only; see docs/loans-spec.md). */
  loans: Loan[];
}

/** An APR in force from `from` (inclusive) until the next rate's `from`. */
export interface LoanRate {
  entryId: EntryId;
  from: LocalDate;
  aprMillionths: number;
}
/** Money drawn: for a linked purchase (`lotId`) or not (`lotId` null). */
export interface LoanDraw {
  entryId: EntryId;
  date: LocalDate;
  cents: Cents;
  lotId: LotId | null;
  /** Every lot the purchase's coins came in as: `lotId` plus the link's `alsoLots` (empty when `lotId` is null). */
  lotIds: LotId[];
}
/** A statement closing day in force from `from` (inclusive). */
export interface LoanStatementDay {
  entryId: EntryId;
  from: LocalDate;
  day: number;
}
export interface LoanPayment {
  entryId: EntryId;
  date: LocalDate;
  interestCents: Cents;
  principalCents: Cents;
  /** Last day the interest covers (resolved default, see `LoanPaymentEntry`). */
  interestThrough: LocalDate;
}
export interface LoanStatement {
  entryId: EntryId;
  date: LocalDate;
  balanceCents: Cents;
}
export interface Loan {
  id: LoanId;
  name: string;
  opened: LocalDate;
  dayCount: DayCount;
  creditLimitCents: Cents | null;
  /** The statement day in force now (the last of `statementDays`), or null. */
  statementDay: number | null;
  /** Statement day history, sorted by `from`. */
  statementDays: LoanStatementDay[];
  closed: boolean;
  /** Sorted by `from`; the first is the rate at opening. */
  rates: LoanRate[];
  /** Sorted by date, then purchase lot id (or draw entry id). */
  draws: LoanDraw[];
  payments: LoanPayment[];
  statements: LoanStatement[];
}
