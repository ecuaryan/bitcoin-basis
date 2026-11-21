/** Read-only views over ledger state: holdings, average cost, per-year summaries and gift totals. */
import { sum } from './book.ts';
import { instantMs } from './dates.ts';
import { mulDivOrNull, SATS_PER_BTC, type Cents, type Sats } from './money.ts';
import { compareStrings } from './order.ts';
import { TIERS, type CharityGift, type EntryId, type LocalDate, type CloseOut, type Disposal, type GiftGiven, type IncomeItem, type LedgerState, type LostRecord, type Recovery, type Tier, type WalletId, type WalletType } from './types.ts';

/**
 * Average cost in cents per BTC (total cost ÷ BTC held, half-up), or null when nothing is held or the
 * figure is too large to represent exactly (e.g. one sat entered at $1,000,000). Show null as "—".
 */
export function averageCostPerBtc(costCents: Cents, sats: Sats): Cents | null {
  return sats === 0 ? null : mulDivOrNull(costCents, SATS_PER_BTC, sats);
}

export interface WalletHolding {
  wallet: WalletId;
  name: string;
  type: WalletType;
  frozen: boolean;
  archived: boolean;
  sats: Sats;
  costCents: Cents;
  averageCostCentsPerBtc: Cents | null;
}

/** The latest balance note of a retirement wallet, checked against the purchases recorded up to its time. */
export interface RetirementSnapshotCheck {
  entryId: EntryId;
  date: LocalDate;
  /** What the custodian showed. */
  sats: Sats;
  /** Purchases recorded up to the note's time. */
  purchasedSats: Sats;
  /** sats − purchasedSats: more (positive) or less (negative) than the purchases add up to. */
  differenceSats: Sats;
  matches: boolean;
}

/**
 * A retirement wallet. Shown separately; never in tax, taxable cost or taxable average-cost figures.
 *
 * Balance rule: with any purchase recorded, the balance is the purchases' total (they carry the cost); with none, it is
 * the latest balance note (0 if none), so a book with balance notes only looks as it always did. When both exist the
 * latest note is checked against the purchases up to its time (`snapshot.differenceSats`), never silently preferred.
 */
export interface RetirementHolding {
  wallet: WalletId;
  name: string;
  archived: boolean;
  /** The balance shown (see the balance rule above). */
  sats: Sats;
  /** Where `sats` comes from. */
  balanceFrom: 'purchases' | 'snapshot' | 'none';
  purchaseCount: number;
  purchaseSats: Sats;
  /** Total paid for the purchases (0 if none). */
  costCents: Cents;
  /** Over the purchases; null with none (or when too large to represent). */
  averageCostCentsPerBtc: Cents | null;
  /** The latest balance note, or null. */
  snapshot: RetirementSnapshotCheck | null;
}

export interface Holdings {
  /** Non-retirement wallets, in creation order. */
  wallets: WalletHolding[];
  /** Totals exclude frozen and retirement wallets. */
  totalSats: Sats;
  totalCostCents: Cents;
  averageCostCentsPerBtc: Cents | null;
  /** Sats by documentation tier, over the same wallets as the totals. */
  documentationMix: Record<Tier, Sats>;
  /** Retirement wallets, in creation order. */
  retirement: RetirementHolding[];
}

/** One retirement wallet's purchases, balance note check and the balance it shows. */
function retirementHolding(state: LedgerState, w: LedgerState['wallets'][number]): RetirementHolding {
  const buys = state.retirementBuys.filter((b) => b.wallet === w.id);
  const purchaseSats = sum(buys.map((b) => b.sats));
  const costCents = sum(buys.map((b) => b.costCents));
  const last = state.retirementSnapshots.filter((s) => s.wallet === w.id).at(-1);
  let snapshot: RetirementSnapshotCheck | null = null;
  if (last !== undefined) {
    const purchasedSats = sum(buys.filter((b) => instantMs(b.at) <= instantMs(last.at)).map((b) => b.sats));
    snapshot = { entryId: last.entryId, date: last.date, sats: last.sats, purchasedSats, differenceSats: last.sats - purchasedSats, matches: last.sats === purchasedSats };
  }
  const balanceFrom = buys.length > 0 ? 'purchases' : snapshot !== null ? 'snapshot' : 'none';
  return {
    wallet: w.id,
    name: w.name,
    archived: w.archived,
    sats: balanceFrom === 'purchases' ? purchaseSats : (snapshot?.sats ?? 0),
    balanceFrom,
    purchaseCount: buys.length,
    purchaseSats,
    costCents,
    averageCostCentsPerBtc: averageCostPerBtc(costCents, purchaseSats),
    snapshot,
  };
}

/** Per-wallet balances and cost, totals and documentation mix. */
export function holdings(state: LedgerState): Holdings {
  const wallets: WalletHolding[] = [];
  const retirement: RetirementHolding[] = [];
  const mix = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, Sats>;
  let totalSats = 0;
  let totalCostCents = 0;
  for (const w of state.wallets) {
    if (w.type === 'retirement') {
      retirement.push(retirementHolding(state, w));
      continue;
    }
    const lots = state.lots.filter((l) => l.wallet === w.id);
    const sats = sum(lots.map((l) => l.sats));
    const costCents = sum(lots.map((l) => l.costCents));
    wallets.push({ wallet: w.id, name: w.name, type: w.type, frozen: w.frozen, archived: w.archived, sats, costCents, averageCostCentsPerBtc: averageCostPerBtc(costCents, sats) });
    if (w.frozen) continue;
    totalSats += sats;
    totalCostCents += costCents;
    for (const l of lots) mix[l.tier] += l.sats;
  }
  return {
    wallets,
    totalSats,
    totalCostCents,
    averageCostCentsPerBtc: averageCostPerBtc(totalCostCents, totalSats),
    documentationMix: mix,
    retirement,
  };
}

export interface YearSummary {
  year: number;
  /** Sales, spending and fees. */
  disposals: Disposal[];
  closeOuts: CloseOut[];
  recoveries: Recovery[];
  /** Short- and long-term totals over disposals, close-out losses and recoveries. */
  stGainCents: Cents;
  ltGainCents: Cents;
  income: IncomeItem[];
  incomeCents: Cents;
  gifts: GiftGiven[];
  charityGifts: CharityGift[];
  lost: LostRecord[];
  /** The Form 1040 digital-asset question: yes if any disposal, fee, gift, close-out, recovery or income. */
  digitalAssetAnswer: 'yes' | 'no';
}

/** Everything that happened in one tax year. */
export function yearSummary(state: LedgerState, year: number): YearSummary {
  const inYear = <T extends { year: number }>(items: readonly T[]): T[] => items.filter((i) => i.year === year);
  const disposals = inYear(state.disposals);
  const closeOuts = inYear(state.closeOuts);
  const recoveries = inYear(state.recoveries);
  const income = inYear(state.income);
  const gifts = inYear(state.gifts);
  const charityGifts = inYear(state.charityGifts);
  const termTotal = (term: 'short' | 'long'): Cents =>
    sum(disposals.map((d) => (term === 'short' ? d.stGainCents : d.ltGainCents))) +
    sum(closeOuts.map((c) => (term === 'short' ? c.stGainCents : c.ltGainCents))) +
    sum(recoveries.map((r) => (term === 'short' ? r.stGainCents : r.ltGainCents)));
  const anyActivity = disposals.length + closeOuts.length + recoveries.length + income.length + gifts.length + charityGifts.length > 0;
  return {
    year,
    disposals,
    closeOuts,
    recoveries,
    stGainCents: termTotal('short'),
    ltGainCents: termTotal('long'),
    income,
    incomeCents: sum(income.map((i) => i.valueCents)),
    gifts,
    charityGifts,
    lost: inYear(state.lost),
    digitalAssetAnswer: anyActivity ? 'yes' : 'no',
  };
}

export interface RecipientTotal {
  /** The recipient label as first written. */
  recipient: string;
  valueCents: Cents;
}

/** Value of gifts to people in a year, per recipient (labels match ignoring case and outer spaces). */
export function giftTotalsByRecipient(state: LedgerState, year: number): RecipientTotal[] {
  const totals = new Map<string, RecipientTotal>();
  for (const g of state.gifts) {
    if (g.year !== year) continue;
    const key = g.recipient.trim().toLowerCase();
    const t = totals.get(key);
    if (t === undefined) totals.set(key, { recipient: g.recipient.trim(), valueCents: g.valueCents });
    else t.valueCents += g.valueCents;
  }
  return [...totals.values()].sort((a, b) => compareStrings(a.recipient, b.recipient));
}

/** Recipients whose gifts that year exceed the annual exclusion (e.g. 1_900_000 cents in 2026). */
export function giftsOverExclusion(state: LedgerState, year: number, exclusionCents: Cents): RecipientTotal[] {
  return giftTotalsByRecipient(state, year).filter((t) => t.valueCents > exclusionCents);
}
