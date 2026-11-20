/**
 * Core types for the ledger: entries (the only stored data), wallets, lots, settings,
 * the replayed ledger state and typed error results. See docs/engine-spec.md.
 */
import type { Cents, Sats } from './money.ts';

/** `{ ok: true, value }` or `{ ok: false, error }`. Used instead of exceptions for user-caused problems. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export type EntryId = string;
export type WalletId = string;
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
export interface GivingPaidEntry extends EntryBase<'giving-paid'> {
  readonly year: number;
  readonly cents: Cents;
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
  | SettingsEntry
  | CloseYearEntry
  | UnlockYearEntry
  | GivingPaidEntry
  | DeleteEntry;

export type EntryKind = Entry['kind'];

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/** State income tax: none, a state's flat rate from the tax tables, or a custom flat rate as a whole number of 1/10000ths (530 = 5.3%). */
export type StateTaxSetting =
  | { readonly kind: 'none' }
  | { readonly kind: 'flat'; readonly state: string }
  | { readonly kind: 'custom'; readonly rate: number };

export interface Settings {
  readonly filingStatus: FilingStatus;
  readonly wagesCents: Cents;
  readonly state: StateTaxSetting;
  /** Loss carried into the current year, as positive cents. */
  readonly carryforwardStCents: Cents;
  readonly carryforwardLtCents: Cents;
  readonly givingEnabled: boolean;
  readonly givingName: string;
  /** Percent, e.g. 10 for 10%. */
  readonly givingPercent: number;
  readonly givingMode: 'before-tax' | 'after-tax';
  readonly earlierMoneyInCents: Cents;
  /** Default time zone for new entries. */
  readonly timeZone: string;
}
export type SettingsPatch = Partial<Settings>;

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
  /** Frozen-payout value received before close-out. */
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
}

/** One lot's share of a disposal, gift or loss. */
export interface PickDetail {
  lotId: LotId;
  sats: Sats;
  costCents: Cents;
  acquiredDate: LocalDate;
  tier: Tier;
  term: Term;
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
  /** Holding period for later recoveries: long if the closed lots were mostly long-term by cost. */
  recoveryTerm: Term;
  pieces: CloseOutPiece[];
}
/** A payout from a closed-out wallet: a gain with basis $0 in the year received. */
export interface Recovery {
  entryId: EntryId;
  wallet: WalletId;
  fromWallet: WalletId;
  closeOutEntryId: EntryId;
  date: LocalDate;
  year: number;
  sats: Sats;
  gainCents: Cents;
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

/** Two or more entries replace the same entry: none of them is applied until resolved. */
export interface Conflict {
  targetId: EntryId;
  versions: Entry[];
}

export interface GivingPaid {
  entryId: EntryId;
  year: number;
  cents: Cents;
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
  | 'not-frozen'
  | 'already-closed-out'
  | 'nothing-to-close-out';

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
  givingPaid: GivingPaid[];
  conflicts: Conflict[];
  closedYears: number[];
  settings: Settings;
  /** Total cost of applied `buy` entries (for "money put in"). */
  buyCostCents: Cents;
  cpaFlags: CpaFlag[];
  errors: LedgerError[];
  /** Ids of the entries applied, in replay order. */
  applied: EntryId[];
}
