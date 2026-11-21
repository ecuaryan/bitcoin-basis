import { allBitcoin, carryforwardFor, TIERS, worthOf, yearOf, type AllBitcoin, type Holdings, type LedgerState, type Lot, type RetirementHolding, type Tier, type WalletType, type Worth } from '@bitcoin-basis/engine';
import { confirmedLabel, satsToCents } from './format.ts';
import { WALLET_TYPE_LABEL } from './wallet-label.ts';

export interface StackYear {
  year: number;
  sats: number;
  byTier: Record<Tier, number>;
  /** The coins themselves, oldest first. */
  lots: Lot[];
}

export interface WalletCard {
  id: string;
  name: string;
  type: WalletType;
  typeLabel: string;
  sats: number;
  costCents: number;
  averageCostCentsPerBtc: number | null;
  /** `Confirmed today`, `Confirmed Nov 2`, or `Not confirmed yet` (`confirmedLabel` in lib/format). */
  confirmedLabel: string;
  /** The last balance check did not match what the wallet's own app showed. */
  needsAttention: boolean;
  frozen: boolean;
}

/** A retirement wallet on Holdings. Never part of the taxable figures. */
export interface RetirementCard {
  id: string;
  name: string;
  sats: number;
  balanceFrom: RetirementHolding['balanceFrom'];
  /** Worth and, when purchases are recorded, cost and gain. */
  worth: Worth;
  /** Cost and gain are known (purchases recorded). */
  costKnown: boolean;
  /** The latest balance note does not match the purchases up to its date. */
  noteDiffers: boolean;
}

export interface HoldingsView {
  totalSats: number;
  totalCostCents: number;
  averageCostCentsPerBtc: number | null;
  /** Null until a price is known. */
  worthCents: number | null;
  gainCents: number | null;
  lotCount: number;
  documentedPercent: number;
  mix: Record<Tier, number>;
  stack: StackYear[];
  wallets: WalletCard[];
  frozen: WalletCard[];
  retirement: RetirementCard[];
  /** Taxable, retirement and all together; null when no retirement wallet holds anything (it would just repeat the total). */
  all: AllBitcoin | null;
  moneyInCents: number;
  /** Proceeds from sales, spending and network fees paid in BTC. */
  moneyOutCents: number;
  carryforwardCents: number;
  /** The tax year the saved losses are for, if one was saved. */
  lossesYear: number | null;
  isEmpty: boolean;
}


export function buildHoldingsView(state: LedgerState, h: Holdings, priceCents: number | null, today: string): HoldingsView {
  const live = new Set(h.wallets.filter((w) => !w.frozen).map((w) => w.wallet));
  const lots = state.lots.filter((l) => live.has(l.wallet));

  const byYear = new Map<number, StackYear>();
  for (const l of lots) {
    const year = yearOf(l.acquiredDate);
    let row = byYear.get(year);
    if (!row) {
      row = { year, sats: 0, byTier: Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>, lots: [] };
      byYear.set(year, row);
    }
    row.sats += l.sats;
    row.byTier[l.tier] += l.sats;
    row.lots.push(l);
  }
  const stack = [...byYear.values()].sort((a, b) => a.year - b.year);
  for (const row of stack) row.lots.sort((a, b) => (a.acquiredAt < b.acquiredAt ? -1 : a.acquiredAt > b.acquiredAt ? 1 : 0));

  const card = (w: Holdings['wallets'][number]): WalletCard => {
    const checks = state.balanceChecks.filter((c) => c.wallet === w.wallet);
    const lastMatch = checks.filter((c) => c.matches).reduce<string | null>((best, c) => (best === null || c.date > best ? c.date : best), null);
    const last = checks.reduce<(typeof checks)[number] | null>((best, c) => (best === null || c.date >= best.date ? c : best), null);
    return {
      id: w.wallet,
      name: w.name,
      type: w.type,
      typeLabel: WALLET_TYPE_LABEL[w.type],
      sats: w.sats,
      costCents: w.costCents,
      averageCostCentsPerBtc: w.averageCostCentsPerBtc,
      confirmedLabel: confirmedLabel(lastMatch, today),
      needsAttention: last !== null && !last.matches,
      frozen: w.frozen,
    };
  };

  const documented = h.documentationMix.documented;
  const worthCents = priceCents === null ? null : satsToCents(h.totalSats, priceCents);
  return {
    totalSats: h.totalSats,
    totalCostCents: h.totalCostCents,
    averageCostCentsPerBtc: h.averageCostCentsPerBtc,
    worthCents,
    gainCents: worthCents === null ? null : worthCents - h.totalCostCents,
    lotCount: lots.length,
    documentedPercent: h.totalSats === 0 ? 0 : Math.round((documented * 100) / h.totalSats),
    mix: h.documentationMix,
    stack,
    wallets: h.wallets
      .filter((w) => !w.frozen && !(w.archived && w.sats === 0))
      .map(card)
      .sort((a, b) => b.sats - a.sats),
    frozen: h.wallets.filter((w) => w.frozen).map(card),
    retirement: h.retirement.map((r) => {
      const costKnown = r.balanceFrom === 'purchases';
      const worth = worthOf(r.sats, r.costCents, priceCents);
      return { id: r.wallet, name: r.name, sats: r.sats, balanceFrom: r.balanceFrom, worth: costKnown ? worth : { ...worth, gainCents: null, percent: null }, costKnown, noteDiffers: costKnown && r.snapshot !== null && !r.snapshot.matches };
    }),
    all: h.retirement.some((r) => r.sats > 0) ? allBitcoin(h, priceCents) : null,
    moneyInCents: h.moneyPutInCents,
    moneyOutCents: state.disposals.reduce((s, d) => s + d.proceedsCents, 0),
    carryforwardCents: (({ st, lt }) => st + lt)(carryforwardFor(state.settings, yearOf(today), yearOf(today))),
    lossesYear: yearOf(today),
    isEmpty: state.wallets.length === 0 && state.lots.length === 0,
  };
}
