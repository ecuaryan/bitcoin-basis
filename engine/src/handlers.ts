/**
 * One handler per entry kind. Each validates fully before changing anything and returns a
 * Problem (the entry is skipped) or null (applied). Internal to replay.
 */
import {
  activeWallet,
  addVolume,
  isProblem,
  lotIdOf,
  lotIdsTaken,
  makeDisposal,
  nameTaken,
  problem,
  sum,
  takeFromLot,
  touch,
  type Book,
  type Payout,
  type Problem,
} from './book.ts';
import { localDate, yearOf } from './dates.ts';
import { splitProportional } from './money.ts';
import { detailOf, oldestFirstOrder, pickProblem, splitMovePicks, withProceeds, type Piece } from './picks.ts';
import type {
  BalanceConfirmEntry,
  BuyEntry,
  CloseOut,
  Entry,
  GiftGiven,
  GiveEntry,
  LocalDate,
  LostEntry,
  Lot,
  LotPick,
  MoveEntry,
  OpeningLotEntry,
  ReceiveEntry,
  Recovery,
  SellEntry,
  Term,
  WalletCloseOutEntry,
  WalletId,
} from './types.ts';

function checkPicks(book: Book, wallet: WalletId, picks: readonly LotPick[], total: number): Problem | null {
  return pickProblem((id) => book.lots.get(id), wallet, picks, total);
}

type NewLot = Pick<Lot, 'costCents' | 'acquiredAt' | 'tier' | 'alwaysLongTerm' | 'proof' | 'lossBasis'>;

/** Create the lot for `e` (id: the root of its version chain), counting `volumeCents` toward the ledger totals. */
function newLot(book: Book, e: OpeningLotEntry | BuyEntry | ReceiveEntry, wallet: WalletId, fields: NewLot, volumeCents: number): Problem | null {
  const id = lotIdOf(book, e);
  const bad = lotIdsTaken(book, [id]) ?? addVolume(book, e.sats, volumeCents);
  if (bad !== null) return bad;
  book.lots.set(id, { id, wallet, sats: e.sats, acquiredDate: localDate(fields.acquiredAt, e.tz), originEntryId: e.id, tz: e.tz, ...fields });
  touch(book, wallet, e.id);
  return null;
}

export function applyOpeningLot(book: Book, e: OpeningLotEntry): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  return newLot(book, e, w.id, { costCents: e.costCents, acquiredAt: e.acquiredAt, tier: e.tier, alwaysLongTerm: false, proof: e.origin, lossBasis: null }, e.costCents);
}

export function applyBuy(book: Book, e: BuyEntry): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  const bad = newLot(book, e, w.id, { costCents: e.costCents, acquiredAt: e.at, tier: e.tier, alwaysLongTerm: false, proof: e.proof ?? w.defaultProof, lossBasis: null }, e.costCents);
  if (bad === null) book.state.buyCostCents += e.costCents;
  return bad;
}

export function applyReceive(book: Book, e: ReceiveEntry, date: LocalDate): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  const src = e.source;
  if (src.type === 'frozen-payout') {
    const from = book.wallets.get(src.fromWallet);
    if (from === undefined) return problem('unknown-wallet', `wallet ${src.fromWallet} does not exist`);
    if (!from.frozen) return problem('not-frozen', `${from.name} is not frozen`);
  }
  let lot: NewLot = { costCents: e.valueCents, acquiredAt: e.at, tier: e.tier ?? 'documented', alwaysLongTerm: src.type === 'inherited', proof: e.proof ?? w.defaultProof, lossBasis: null };
  const costKnown = src.type === 'gift' && src.giverCostCents !== undefined;
  if (src.type === 'gift') {
    const costCents = src.giverCostCents ?? 0;
    // Dual basis: worth less at the gift than the giver's cost. A loss is then measured from the value at the gift.
    const lossBasis = costKnown && e.valueCents < costCents ? { costCents: e.valueCents, acquiredDate: date } : null;
    lot = { ...lot, costCents, acquiredAt: src.giverAcquiredAt ?? e.at, tier: e.tier ?? (costKnown ? 'documented' : 'unknown'), lossBasis };
  }
  const bad = newLot(book, e, w.id, lot, e.valueCents + lot.costCents);
  if (bad !== null) return bad;
  const year = yearOf(date);
  if (src.type === 'income') book.state.income.push({ entryId: e.id, wallet: w.id, date, year, sats: e.sats, valueCents: e.valueCents, description: src.description ?? null });
  if (src.type === 'gift') {
    const dualBasis = lot.lossBasis !== null;
    book.state.giftsReceived.push({ entryId: e.id, wallet: w.id, date, year, sats: e.sats, valueCents: e.valueCents, costCents: lot.costCents, costKnown, acquiredDate: localDate(lot.acquiredAt, e.tz), dualBasis });
    if (dualBasis) book.state.cpaFlags.push({ entryId: e.id, code: 'dual-basis', message: "Gift worth less than the giver's cost (dual basis): a gain uses the giver's cost, a loss the value at the gift. Confirm with your CPA." });
  }
  if (src.type === 'frozen-payout') book.payouts.push({ entryId: e.id, wallet: w.id, fromWallet: src.fromWallet, date, sats: e.sats, valueCents: e.valueCents });
  return null;
}

export function applyMove(book: Book, e: MoveEntry, date: LocalDate): Problem | null {
  const from = activeWallet(book, e.from);
  if (isProblem(from)) return from;
  const to = activeWallet(book, e.to);
  if (isProblem(to)) return to;
  const bad = checkPicks(book, from.id, e.picks, e.sats + e.feeSats);
  if (bad !== null) return bad;
  const { moved, fee } = splitMovePicks(e.picks, e.sats);
  const root = lotIdOf(book, e);
  // Pieces are keyed by source lot (picks name each lot once), so reordering picks in an edit keeps their ids.
  const pieceId = (lotId: string): string => `${root}:${lotId}`;
  const blocked = lotIdsTaken(book, e.picks.filter((_, i) => (moved[i] as number) > 0).map((p) => pieceId(p.lotId))) ?? addVolume(book, 0, e.feeValueCents);
  if (blocked !== null) return blocked;
  e.picks.forEach((p, i) => {
    const sats = moved[i] as number;
    if (sats === 0) return;
    const src = book.lots.get(p.lotId) as Lot;
    const piece = takeFromLot(book, p.lotId, sats, date);
    const lossBasis = piece.lossBasis === null ? null : { costCents: piece.lossBasis.costCents, acquiredDate: piece.lossBasis.acquiredDate };
    book.lots.set(pieceId(p.lotId), { ...src, id: pieceId(p.lotId), wallet: to.id, sats, costCents: piece.costCents, lossBasis });
  });
  const feePieces = e.picks.flatMap((p, i) => ((fee[i] as number) > 0 ? [takeFromLot(book, p.lotId, fee[i] as number, date)] : []));
  if (feePieces.length > 0) book.state.disposals.push(makeDisposal(e, 'fee', from.id, date, feePieces, e.feeValueCents, null));
  touch(book, from.id, e.id);
  touch(book, to.id, e.id);
  return null;
}

/** Validate a disposal from one wallet and count `cents` toward the ledger totals; then take the picked pieces. */
function takePicks(book: Book, e: SellEntry | GiveEntry | LostEntry, date: LocalDate, cents: number): { wallet: WalletId; pieces: Piece[] } | Problem {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  const bad = checkPicks(book, w.id, e.picks, e.sats) ?? addVolume(book, 0, cents);
  if (bad !== null) return bad;
  touch(book, w.id, e.id);
  return { wallet: w.id, pieces: e.picks.map((p) => takeFromLot(book, p.lotId, p.sats, date)) };
}

export function applySell(book: Book, e: SellEntry, date: LocalDate): Problem | null {
  const taken = takePicks(book, e, date, e.proceedsCents);
  if ('code' in taken) return taken;
  book.state.disposals.push(makeDisposal(e, e.spent ? 'spend' : 'sell', taken.wallet, date, taken.pieces, e.proceedsCents, e.description ?? null));
  return null;
}

export function applyGive(book: Book, e: GiveEntry, date: LocalDate): Problem | null {
  const taken = takePicks(book, e, date, e.valueCents);
  if ('code' in taken) return taken;
  const values = splitProportional(e.valueCents, taken.pieces.map((p) => p.sats));
  const picks = taken.pieces.map((p, i) => ({ ...detailOf(p), valueCents: values[i] as number }));
  const gift: GiftGiven = { entryId: e.id, wallet: taken.wallet, recipient: e.recipient, date, year: yearOf(date), sats: e.sats, valueCents: e.valueCents, costCents: sum(picks.map((p) => p.costCents)), picks };
  if (e.to === 'person') {
    book.state.gifts.push(gift);
  } else {
    const deductionCents = sum(picks.map((p) => (p.term === 'long' ? p.valueCents : Math.min(p.costCents, p.valueCents))));
    book.state.charityGifts.push({ ...gift, deductionCents, appraisalFlag: false });
  }
  return null;
}

export function applyLost(book: Book, e: LostEntry, date: LocalDate): Problem | null {
  const taken = takePicks(book, e, date, 0);
  if ('code' in taken) return taken;
  const picks = taken.pieces.map(detailOf);
  book.state.lost.push({ entryId: e.id, wallet: taken.wallet, cause: e.cause, date, year: yearOf(date), sats: e.sats, costCents: sum(picks.map((p) => p.costCents)), picks });
  book.state.cpaFlags.push({ entryId: e.id, code: 'lost-coins', message: 'Lost coins: no deduction recorded. Ask your CPA whether any loss can be claimed.' });
  return null;
}

/** Empties the frozen wallet. The recovered dollars and gains are settled after replay (`settleFrozenWallets`). */
export function applyCloseOut(book: Book, e: WalletCloseOutEntry, date: LocalDate): Problem | null {
  const w = book.wallets.get(e.wallet);
  if (w === undefined) return problem('unknown-wallet', `wallet ${e.wallet} does not exist`);
  if (!w.frozen) return problem('not-frozen', `${w.name} must be frozen before close-out`);
  if (w.closeOutEntryId !== null) return problem('already-closed-out', `${w.name} was already closed out`);
  const lots = oldestFirstOrder([...book.lots.values()], w.id);
  if (lots.length === 0) return problem('nothing-to-close-out', `${w.name} holds no coins`);
  const lossDate = e.lossDate ?? date;
  const earliest = (lots[0] as Lot).acquiredDate;
  if (lossDate < earliest) return problem('invalid-loss-date', `the loss date ${lossDate} is before ${w.name}'s earliest coins (${earliest})`);
  const pieces = lots.map((l) => takeFromLot(book, l.id, l.sats, lossDate));
  const closeOut: CloseOut = { entryId: e.id, wallet: w.id, lossDate, year: yearOf(lossDate), sats: sum(pieces.map((p) => p.sats)), costCents: 0, recoveredCents: 0, gainCents: 0, stGainCents: 0, ltGainCents: 0, recoveryTerm: 'long', pieces: [] };
  w.closeOutEntryId = e.id;
  book.closeOuts.set(w.id, { closeOut, pieces });
  book.state.closeOuts.push(closeOut);
  touch(book, w.id, e.id);
  return null;
}

/** How later recoveries split [short, long]: by the close-out's short- and long-term losses, or by sats if it had no loss. */
function recoveryWeights(c: CloseOut): [number, number] {
  const losses: [number, number] = [Math.max(0, -c.stGainCents), Math.max(0, -c.ltGainCents)];
  const bySats = (t: 'short' | 'long'): number => sum(c.pieces.filter((x) => x.term === t).map((x) => x.sats));
  return sum(losses) > 0 ? losses : [bySats('short'), bySats('long')];
}

const largerTerm = ([st, lt]: readonly number[]): Term => ((st as number) > (lt as number) ? 'short' : 'long');

/** Fill in a close-out from the dollars recovered by its loss date: split across lots by cost (by sats if all cost $0). */
function settleCloseOut(c: CloseOut, pieces: readonly Piece[], recoveredCents: number): void {
  const anyCost = pieces.some((p) => p.costCents > 0);
  const shares = splitProportional(recoveredCents, pieces.map((p) => (anyCost ? p.costCents : p.sats)));
  c.pieces = pieces.map((p, i) => {
    const { proceedsCents, ...rest } = withProceeds(p, shares[i] as number);
    return { ...rest, recoveredCents: proceedsCents };
  });
  const termGain = (term: 'short' | 'long'): number => sum(c.pieces.filter((p) => p.term === term).map((p) => p.gainCents));
  c.costCents = sum(c.pieces.map((p) => p.costCents));
  c.recoveredCents = recoveredCents;
  c.gainCents = recoveredCents - c.costCents;
  c.stGainCents = termGain('short');
  c.ltGainCents = termGain('long');
  c.recoveryTerm = largerTerm(recoveryWeights(c));
}

/** A payout after the loss date: a gain split short/long by the close-out's losses (by sats if it had none). */
function recoveryOf(p: Payout, c: CloseOut): Recovery {
  const [st, lt] = splitProportional(p.valueCents, recoveryWeights(c)) as [number, number];
  return { entryId: p.entryId, wallet: p.wallet, fromWallet: p.fromWallet, closeOutEntryId: c.entryId, date: p.date, year: yearOf(p.date), sats: p.sats, gainCents: p.valueCents, stGainCents: st, ltGainCents: lt, term: largerTerm([st, lt]) };
}

/**
 * After replay: payouts dated on or before a close-out's loss date reduce the loss; later ones are
 * recoveries, whatever order the entries were logged in.
 */
export function settleFrozenWallets(book: Book): void {
  for (const w of book.wallets.values()) {
    const payouts = book.payouts.filter((p) => p.fromWallet === w.id);
    const closed = book.closeOuts.get(w.id);
    const reducesLoss = (p: Payout): boolean => closed === undefined || p.date <= closed.closeOut.lossDate;
    w.recoveredCents = sum(payouts.filter(reducesLoss).map((p) => p.valueCents));
    if (closed === undefined) continue;
    settleCloseOut(closed.closeOut, closed.pieces, w.recoveredCents);
    for (const p of payouts) if (!reducesLoss(p)) book.state.recoveries.push(recoveryOf(p, closed.closeOut));
  }
}

export function applyBalanceConfirm(book: Book, e: BalanceConfirmEntry, date: LocalDate): Problem | null {
  const w = book.wallets.get(e.wallet);
  if (w === undefined) return problem('unknown-wallet', `wallet ${e.wallet} does not exist`);
  if (w.type === 'retirement') return problem('retirement-wallet', 'use a retirement snapshot for retirement wallets');
  const ledgerSats = sum([...book.lots.values()].filter((l) => l.wallet === w.id).map((l) => l.sats));
  const matches = ledgerSats === e.sats;
  const since = book.touched.get(w.id) ?? [];
  book.state.balanceChecks.push({ entryId: e.id, wallet: w.id, date, reportedSats: e.sats, ledgerSats, differenceSats: e.sats - ledgerSats, matches, entriesSinceLastMatch: matches ? [] : [...since] });
  if (matches) book.touched.set(w.id, []);
  return null;
}

const nameTakenProblem = (name: string): Problem => problem('wallet-name-taken', `another wallet is already named "${name.trim()}"`);

/** Apply any entry kind. */
export function applyEntry(book: Book, e: Entry, date: LocalDate): Problem | null {
  switch (e.kind) {
    case 'wallet':
      if (book.wallets.has(e.wallet)) return problem('wallet-exists', `wallet ${e.wallet} already exists`);
      if (nameTaken(book, e.name, null)) return nameTakenProblem(e.name);
      book.wallets.set(e.wallet, { id: e.wallet, name: e.name, type: e.type, defaultProof: e.defaultProof, archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0 });
      return null;
    case 'wallet-update': {
      const w = book.wallets.get(e.wallet);
      if (w === undefined) return problem('unknown-wallet', `wallet ${e.wallet} does not exist`);
      const name = e.name ?? w.name;
      const archived = e.archived ?? w.archived;
      if (!archived && nameTaken(book, name, w.id)) return nameTakenProblem(name);
      w.name = name;
      w.archived = archived;
      return null;
    }
    case 'wallet-freeze': {
      const w = book.wallets.get(e.wallet);
      if (w === undefined) return problem('unknown-wallet', `wallet ${e.wallet} does not exist`);
      if (w.type === 'retirement') return problem('retirement-wallet', 'retirement wallets cannot be frozen');
      w.frozen = true;
      return null;
    }
    case 'wallet-close-out':
      return applyCloseOut(book, e, date);
    case 'opening-lot':
      return applyOpeningLot(book, e);
    case 'buy':
      return applyBuy(book, e);
    case 'receive':
      return applyReceive(book, e, date);
    case 'move':
      return applyMove(book, e, date);
    case 'sell':
      return applySell(book, e, date);
    case 'give':
      return applyGive(book, e, date);
    case 'lost':
      return applyLost(book, e, date);
    case 'balance-confirm':
      return applyBalanceConfirm(book, e, date);
    case 'retirement-snapshot': {
      const w = book.wallets.get(e.wallet);
      if (w === undefined) return problem('unknown-wallet', `wallet ${e.wallet} does not exist`);
      if (w.type !== 'retirement') return problem('not-retirement-wallet', `${w.name} is not a retirement wallet`);
      book.state.retirementSnapshots.push({ entryId: e.id, wallet: w.id, at: e.at, date, sats: e.sats });
      return null;
    }
    case 'settings':
      book.state.settings = { ...book.state.settings, ...e.patch };
      return null;
    case 'giving-paid': {
      const bad = addVolume(book, 0, e.cents);
      if (bad === null) book.state.givingPaid.push({ entryId: e.id, year: e.year, cents: e.cents });
      return bad;
    }
    case 'close-year':
    case 'unlock-year':
    case 'delete':
      return null;
  }
}
