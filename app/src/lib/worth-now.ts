import { traceCoins, type Lot, type LedgerState } from '@bitcoin-basis/engine';
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

/**
 * The coins that came from one buy or receive entry (any of its versions, `entryIds`): what is still held, wherever it
 * moved, and what has been sold, spent, given or lost (one part per entry that took some). Coins in a frozen wallet are
 * not counted as held. Thin wrapper over the engine's `traceCoins`.
 */
export function entryWorth(state: LedgerState, entryIds: readonly string[], priceCents: number | null): EntryWorth {
  const traced = traceCoins(state, entryIds);
  const parts = new Map<string, GonePart>();
  for (const g of traced.gone) {
    if (g.kind === 'closed-out') continue;
    const part = parts.get(g.entryId);
    if (part === undefined) parts.set(g.entryId, { kind: g.kind, sats: g.sats, date: g.date });
    else part.sats += g.sats;
  }
  return { held: sumWorth(traced.held, priceCents), gone: [...parts.values()] };
}
