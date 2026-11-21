/**
 * Follow the coins of one purchase (or any entry that created coins) through moves to wherever they are now,
 * and to every sale, spending, fee, gift, loss or close-out that took some of them.
 */
import { sum } from './book.ts';
import { compareStrings } from './order.ts';
import type { Cents, Sats } from './money.ts';
import type { EntryId, LedgerState, LocalDate, Lot, LotId } from './types.ts';

/**
 * The lot a piece came from: a lot id is the root id of the entry that created the coins, and a moved piece is
 * `<moveRootId>:<sourceLotId>` (nested when moved again), so the origin is the last part.
 */
export function originLotId(lotId: LotId): LotId {
  return lotId.slice(lotId.lastIndexOf(':') + 1);
}

export type GoneKind = 'sold' | 'spent' | 'fees' | 'given' | 'lost' | 'closed-out';

/** Some of the traced coins that have left: one per lot piece of the entry that took them. */
export interface GonePiece {
  kind: GoneKind;
  entryId: EntryId;
  date: LocalDate;
  lotId: LotId;
  sats: Sats;
  costCents: Cents;
  /** Sale proceeds or the value of what was bought (sold, spent); 0 for every other kind. */
  proceedsCents: Cents;
}

export interface TracedCoins {
  /** Open lots holding the coins now (any wallet that is not frozen). */
  held: Lot[];
  /** Open lots in frozen wallets: still yours on paper, but not counted as held. */
  frozen: Lot[];
  /** Pieces that have left, by date (same date: sales, spending and fees, then gifts, losses, close-outs). */
  gone: GonePiece[];
  heldSats: Sats;
  heldCostCents: Cents;
  frozenSats: Sats;
  frozenCostCents: Cents;
}

/**
 * Coins that came from the entries `ids` (a lot id, or any versions of the entry that created the coins). Sats
 * add back exactly: what the entry created = held + frozen + gone; so does cost for coins without a gift's dual
 * basis (a disposal of those reports the basis actually used).
 */
export function traceCoins(state: LedgerState, ids: readonly string[]): TracedCoins {
  const given = new Set(ids);
  const roots = new Set([...given, ...state.lots.filter((l) => given.has(l.originEntryId)).map((l) => originLotId(l.id))]);
  const mine = (lotId: LotId): boolean => roots.has(originLotId(lotId));
  const frozenWallets = new Set(state.wallets.filter((w) => w.frozen).map((w) => w.id));
  const open = state.lots.filter((l) => mine(l.id));
  const held = open.filter((l) => !frozenWallets.has(l.wallet));
  const frozen = open.filter((l) => frozenWallets.has(l.wallet));
  const gone: GonePiece[] = [];
  const take = (kind: GoneKind, entryId: EntryId, date: LocalDate, picks: readonly { lotId: LotId; sats: Sats; costCents: Cents; proceedsCents?: Cents }[]): void => {
    for (const p of picks) if (mine(p.lotId)) gone.push({ kind, entryId, date, lotId: p.lotId, sats: p.sats, costCents: p.costCents, proceedsCents: kind === 'sold' || kind === 'spent' ? (p.proceedsCents as Cents) : 0 });
  };
  for (const d of state.disposals) take(d.kind === 'sell' ? 'sold' : d.kind === 'spend' ? 'spent' : 'fees', d.entryId, d.date, d.picks);
  for (const g of [...state.gifts, ...state.charityGifts]) take('given', g.entryId, g.date, g.picks);
  for (const l of state.lost) take('lost', l.entryId, l.date, l.picks);
  for (const c of state.closeOuts) take('closed-out', c.entryId, c.lossDate, c.pieces);
  gone.sort((a, b) => compareStrings(a.date, b.date));
  return {
    held,
    frozen,
    gone,
    heldSats: sum(held.map((l) => l.sats)),
    heldCostCents: sum(held.map((l) => l.costCents)),
    frozenSats: sum(frozen.map((l) => l.sats)),
    frozenCostCents: sum(frozen.map((l) => l.costCents)),
  };
}
