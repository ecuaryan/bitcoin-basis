/** Read-only views over ledger state: holdings, average cost, per-year summaries and gift totals. */
import { sum } from './book.ts';
import { mulDivRoundHalfUp, SATS_PER_BTC, type Cents, type Sats } from './money.ts';
import { compareStrings } from './order.ts';
import { TIERS, type CharityGift, type CloseOut, type Disposal, type GiftGiven, type IncomeItem, type LedgerState, type LostRecord, type Recovery, type Tier, type WalletId, type WalletType } from './types.ts';

/** Average cost in cents per BTC (total cost ÷ BTC held, half-up), or null when nothing is held. */
export function averageCostPerBtc(costCents: Cents, sats: Sats): Cents | null {
  return sats === 0 ? null : mulDivRoundHalfUp(costCents, SATS_PER_BTC, sats);
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

export interface RetirementHolding {
  wallet: WalletId;
  name: string;
  /** Latest snapshot (0 if none yet). Shown separately; never in tax or cost figures. */
  sats: Sats;
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
  /** Buy costs plus "earlier money in" from settings. Never used in tax math. */
  moneyPutInCents: Cents;
  retirement: RetirementHolding[];
}

/** Per-wallet balances and cost, totals, documentation mix and money put in. */
export function holdings(state: LedgerState): Holdings {
  const wallets: WalletHolding[] = [];
  const retirement: RetirementHolding[] = [];
  const mix = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, Sats>;
  let totalSats = 0;
  let totalCostCents = 0;
  for (const w of state.wallets) {
    if (w.type === 'retirement') {
      const snaps = state.retirementSnapshots.filter((s) => s.wallet === w.id);
      retirement.push({ wallet: w.id, name: w.name, sats: snaps.at(-1)?.sats ?? 0 });
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
    moneyPutInCents: state.buyCostCents + state.settings.earlierMoneyInCents,
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
  givingPaidCents: Cents;
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
    sum(recoveries.filter((r) => r.term === term).map((r) => r.gainCents));
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
    givingPaidCents: sum(inYear(state.givingPaid).map((g) => g.cents)),
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
