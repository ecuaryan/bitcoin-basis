/** Mutable working state used while replaying, plus the shared lot-taking helpers. Internal. */
import { splitProportional, type Cents } from './money.ts';
import { splitCost, termFor } from './picks.ts';
import type { CloseOut, Disposal, DisposalPick, Entry, EntryId, LedgerErrorCode, LedgerState, LocalDate, Lot, LotId, PickDetail, Wallet, WalletId } from './types.ts';
import { yearOf } from './dates.ts';

/** Why an entry could not be applied. */
export interface Problem {
  code: LedgerErrorCode;
  message: string;
}

export interface Book {
  wallets: Map<WalletId, Wallet>;
  /** Every lot ever created (including emptied ones), in creation order. */
  lots: Map<LotId, Lot>;
  closeOuts: Map<WalletId, CloseOut>;
  /** Entries touching each wallet since its last matching balance confirmation. */
  touched: Map<WalletId, EntryId[]>;
  state: LedgerState;
}

export function problem(code: LedgerErrorCode, message: string): Problem {
  return { code, message };
}

/** A wallet that can hold lots and take part in disposals right now, or why not. */
export function activeWallet(book: Book, id: WalletId): Wallet | Problem {
  const w = book.wallets.get(id);
  if (w === undefined) return problem('unknown-wallet', `wallet ${id} does not exist`);
  if (w.type === 'retirement') return problem('retirement-wallet', `${w.name} is a retirement wallet (balance snapshots only)`);
  if (w.frozen) return problem('wallet-frozen', `${w.name} is frozen`);
  return w;
}

export function isProblem(v: Wallet | Problem): v is Problem {
  return 'code' in v;
}

export function touch(book: Book, wallet: WalletId, entryId: EntryId): void {
  const list = book.touched.get(wallet);
  if (list === undefined) book.touched.set(wallet, [entryId]);
  else list.push(entryId);
}

export function addLot(book: Book, lot: Lot): void {
  book.lots.set(lot.id, lot);
}

/** Take `sats` from a lot (already validated), returning that piece's cost and holding period. */
export function takeFromLot(book: Book, lotId: LotId, sats: number, date: LocalDate): PickDetail {
  const lot = book.lots.get(lotId) as Lot;
  const costCents = splitCost(lot.sats, lot.costCents, sats);
  lot.sats -= sats;
  lot.costCents -= costCents;
  return { lotId, sats, costCents, acquiredDate: lot.acquiredDate, tier: lot.tier, term: termFor(lot, date) };
}

export function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** A disposal with proceeds split across its pieces by sats (half-up, remainder on the last). */
export function makeDisposal(e: Entry, kind: Disposal['kind'], wallet: WalletId, date: LocalDate, pieces: readonly PickDetail[], proceedsCents: Cents, description: string | null): Disposal {
  const shares = splitProportional(proceedsCents, pieces.map((p) => p.sats));
  const picks: DisposalPick[] = pieces.map((p, i) => {
    const proceeds = shares[i] as number;
    return { ...p, proceedsCents: proceeds, gainCents: proceeds - p.costCents };
  });
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
