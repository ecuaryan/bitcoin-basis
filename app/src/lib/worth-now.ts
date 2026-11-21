import type { Lot, LedgerState } from '@bitcoin-basis/engine';
import { satsToCents } from './format.ts';

/** What some coins are worth at the live price, against what they cost. Money is whole cents. */
export interface WorthNow {
  sats: number;
  costCents: number;
  /** Null while no price is known. */
  valueCents: number | null;
  gainCents: number | null;
  /** Whole percent toward zero (never overstates a gain). Null with no price or no cost. */
  percent: number | null;
}

export function worthNow(sats: number, costCents: number, priceCents: number | null): WorthNow {
  return fromParts(sats, costCents, priceCents === null ? null : satsToCents(sats, priceCents));
}

function fromParts(sats: number, costCents: number, valueCents: number | null): WorthNow {
  if (valueCents === null) return { sats, costCents, valueCents: null, gainCents: null, percent: null };
  const gainCents = valueCents - costCents;
  let percent: number | null = null;
  if (costCents > 0) {
    const magnitude = Number((BigInt(Math.abs(gainCents)) * 100n) / BigInt(costCents));
    percent = gainCents < 0 ? -magnitude : magnitude;
  }
  return { sats, costCents, valueCents, gainCents, percent };
}

/** Several coins together: each coin is valued on its own, so the lines add up to the total. */
export function sumWorth(lots: readonly Pick<Lot, 'sats' | 'costCents'>[], priceCents: number | null): WorthNow {
  let sats = 0;
  let cost = 0;
  let value = 0;
  for (const l of lots) {
    sats += l.sats;
    cost += l.costCents;
    if (priceCents !== null) value += satsToCents(l.sats, priceCents);
  }
  return fromParts(sats, cost, priceCents === null ? null : value);
}

export type PartKind = 'sold' | 'spent' | 'fees' | 'given' | 'lost';

/** A piece of an entry's coins that has left. */
export interface GonePart {
  kind: PartKind;
  sats: number;
  date: string;
}

export interface EntryWorth {
  held: WorthNow;
  gone: GonePart[];
}

/** The lot an id belongs to: pieces moved to other wallets are named `<lot>:<source lot>`. */
function rootOf(id: string): string {
  const i = id.indexOf(':');
  return i === -1 ? id : id.slice(0, i);
}

/**
 * The coins that came from one buy or receive entry (any of its versions, `entryIds`): what is still held, wherever it
 * moved, and what has been sold, spent, given or lost. Coins in a frozen wallet are not counted as held.
 */
export function entryWorth(state: LedgerState, entryIds: readonly string[], priceCents: number | null): EntryWorth {
  const ids = new Set(entryIds);
  const mine = (lotId: string) => ids.has(rootOf(lotId));
  const frozen = new Set(state.wallets.filter((w) => w.frozen).map((w) => w.id));
  const held = state.lots.filter((l) => !frozen.has(l.wallet) && (ids.has(l.originEntryId) || mine(l.id)));
  const gone: GonePart[] = [];
  const take = (kind: PartKind, date: string, picks: readonly { lotId: string; sats: number }[]) => {
    const sats = picks.filter((p) => mine(p.lotId)).reduce((s, p) => s + p.sats, 0);
    if (sats > 0) gone.push({ kind, sats, date });
  };
  for (const d of state.disposals) take(d.kind === 'sell' ? 'sold' : d.kind === 'spend' ? 'spent' : 'fees', d.date, d.picks);
  for (const g of state.gifts) take('given', g.date, g.picks);
  for (const l of state.lost) take('lost', l.date, l.picks);
  gone.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { held: sumWorth(held, priceCents), gone };
}
