/** Mutable working state used while replaying, plus the shared lot-taking helpers. Internal. */
import { MAX_LEDGER_TOTAL, splitProportional, type Cents, type Sats } from './money.ts';
import { pieceOf, withProceeds, type Piece } from './picks.ts';
import type { CloseOut, Disposal, Entry, EntryId, LedgerErrorCode, LedgerState, LocalDate, Lot, LotId, Wallet, WalletId } from './types.ts';
import { yearOf } from './dates.ts';

/** Why an entry could not be applied. */
export interface Problem {
  code: LedgerErrorCode;
  message: string;
}

/** A frozen-platform payout, settled against its wallet's close-out after replay. */
export interface Payout {
  entryId: EntryId;
  wallet: WalletId;
  fromWallet: WalletId;
  date: LocalDate;
  sats: Sats;
  valueCents: Cents;
}

export interface Book {
  wallets: Map<WalletId, Wallet>;
  /** Every lot ever created (including emptied ones), in creation order. */
  lots: Map<LotId, Lot>;
  /** Each closed-out wallet's close-out and the pieces it emptied (recovered dollars are filled in after replay). */
  closeOuts: Map<WalletId, { closeOut: CloseOut; pieces: Piece[] }>;
  payouts: Payout[];
  /** Entries touching each wallet since its last matching balance confirmation. */
  touched: Map<WalletId, EntryId[]>;
  /** Root of each applied entry's version chain: lots keep that id through edits. */
  rootOf: ReadonlyMap<EntryId, EntryId>;
  /** Running totals of sats acquired and cents entered, kept under MAX_LEDGER_TOTAL. */
  volume: { sats: Sats; cents: Cents };
  /** The same running totals for retirement purchases, kept apart so they can never refuse a taxable entry. */
  retirementVolume: { sats: Sats; cents: Cents };
  state: LedgerState;
}

export function newBook(state: LedgerState, rootOf: ReadonlyMap<EntryId, EntryId>): Book {
  return { wallets: new Map(), lots: new Map(), closeOuts: new Map(), payouts: [], touched: new Map(), rootOf, volume: { sats: 0, cents: 0 }, retirementVolume: { sats: 0, cents: 0 }, state };
}

export function problem(code: LedgerErrorCode, message: string): Problem {
  return { code, message };
}

/** Lot id for coins created by `e`: the root of its version chain. */
export function lotIdOf(book: Book, e: Entry): LotId {
  return book.rootOf.get(e.id) ?? e.id;
}

/** A wallet that can hold lots and take part in disposals right now, or why not. */
export function activeWallet(book: Book, id: WalletId): Wallet | Problem {
  const w = book.wallets.get(id);
  if (w === undefined) return problem('unknown-wallet', `wallet ${id} does not exist`);
  if (w.type === 'retirement') return problem('retirement-wallet', `${w.name} is a retirement wallet (kept apart from tax math; log its purchases there)`);
  if (w.frozen) return problem('wallet-frozen', `${w.name} is frozen`);
  return w;
}

export function isProblem(v: Wallet | Problem): v is Problem {
  return 'code' in v;
}

/** Wallet names compare ignoring case and outer spaces. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** True if a non-archived wallet other than `except` already uses `name`. */
export function nameTaken(book: Book, name: string, except: WalletId | null): boolean {
  return [...book.wallets.values()].some((w) => w.id !== except && !w.archived && nameKey(w.name) === nameKey(name));
}

export function touch(book: Book, wallet: WalletId, entryId: EntryId): void {
  const list = book.touched.get(wallet);
  if (list === undefined) book.touched.set(wallet, [entryId]);
  else list.push(entryId);
}

/** Refuse lot ids already in use (defensive: entry ids cannot contain `:`, so this should never happen). */
export function lotIdsTaken(book: Book, ids: readonly LotId[]): Problem | null {
  const taken = ids.find((id) => book.lots.has(id));
  return taken === undefined ? null : problem('duplicate-lot', `lot ${taken} already exists`);
}

/**
 * Count an entry's new sats and cents toward the ledger totals (`v`, default the coin ledger's), or refuse it as out
 * of range. Call it last, after every other check, because it records the amounts.
 */
export function addVolume(book: Book, sats: Sats, cents: Cents, v: { sats: Sats; cents: Cents } = book.volume): Problem | null {
  if (v.sats + sats > MAX_LEDGER_TOTAL || v.cents + cents > MAX_LEDGER_TOTAL) return problem('out-of-range', 'this entry would push the ledger past the amounts it can add up exactly');
  v.sats += sats;
  v.cents += cents;
  return null;
}

/** Take `sats` from a lot (already validated), returning that piece. */
export function takeFromLot(book: Book, lotId: LotId, sats: number, date: LocalDate): Piece {
  const lot = book.lots.get(lotId) as Lot;
  const piece = pieceOf(lot, sats, date);
  lot.sats -= sats;
  lot.costCents -= piece.costCents;
  if (lot.lossBasis !== null && piece.lossBasis !== null) lot.lossBasis = { ...lot.lossBasis, costCents: lot.lossBasis.costCents - piece.lossBasis.costCents };
  return piece;
}

export function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** A disposal with proceeds split across its pieces by sats (half-up, remainder on the last). */
export function makeDisposal(e: Entry, kind: Disposal['kind'], wallet: WalletId, date: LocalDate, pieces: readonly Piece[], proceedsCents: Cents, description: string | null): Disposal {
  const shares = splitProportional(proceedsCents, pieces.map((p) => p.sats));
  const picks = pieces.map((p, i) => withProceeds(p, shares[i] as number));
  const costCents = sum(picks.map((p) => p.costCents));
  return {
    entryId: e.id,
    kind,
    wallet,
    at: e.at,
    date,
    year: yearOf(date),
    sats: sum(picks.map((p) => p.sats)),
    proceedsCents,
    costCents,
    gainCents: proceedsCents - costCents,
    stGainCents: sum(picks.filter((p) => p.term === 'short').map((p) => p.gainCents)),
    ltGainCents: sum(picks.filter((p) => p.term === 'long').map((p) => p.gainCents)),
    picks,
    description,
  };
}
