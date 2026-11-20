/**
 * One handler per entry kind. Each validates fully before changing anything and returns a
 * Problem (the entry is skipped) or null (applied). Internal to replay.
 */
import { activeWallet, addLot, isProblem, makeDisposal, problem, sum, takeFromLot, touch, type Book, type Problem } from './book.ts';
import { localDate, yearOf } from './dates.ts';
import { splitProportional } from './money.ts';
import { oldestFirstOrder, pickProblem, splitMovePicks, termFor } from './picks.ts';
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
  SellEntry,
  WalletCloseOutEntry,
  WalletId,
} from './types.ts';

function checkPicks(book: Book, wallet: WalletId, picks: readonly LotPick[], total: number): Problem | null {
  return pickProblem((id) => book.lots.get(id), wallet, picks, total);
}

function newLot(book: Book, e: OpeningLotEntry | BuyEntry | ReceiveEntry, wallet: WalletId, fields: { costCents: number; acquiredAt: string; tier: Lot['tier']; alwaysLongTerm: boolean; proof: string }): void {
  addLot(book, {
    id: e.id,
    wallet,
    sats: e.sats,
    costCents: fields.costCents,
    acquiredDate: localDate(fields.acquiredAt, e.tz),
    acquiredAt: fields.acquiredAt,
    tier: fields.tier,
    proof: fields.proof,
    originEntryId: e.id,
    alwaysLongTerm: fields.alwaysLongTerm,
  });
  touch(book, wallet, e.id);
}

export function applyOpeningLot(book: Book, e: OpeningLotEntry): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  newLot(book, e, w.id, { costCents: e.costCents, acquiredAt: e.acquiredAt, tier: e.tier, alwaysLongTerm: false, proof: e.origin });
  return null;
}

export function applyBuy(book: Book, e: BuyEntry): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  newLot(book, e, w.id, { costCents: e.costCents, acquiredAt: e.at, tier: e.tier, alwaysLongTerm: false, proof: e.proof ?? w.defaultProof });
  book.state.buyCostCents += e.costCents;
  return null;
}

export function applyReceive(book: Book, e: ReceiveEntry, date: LocalDate): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  const proof = e.proof ?? w.defaultProof;
  const tier = e.tier ?? 'documented';
  const year = yearOf(date);
  const src = e.source;
  switch (src.type) {
    case 'income':
      newLot(book, e, w.id, { costCents: e.valueCents, acquiredAt: e.at, tier, alwaysLongTerm: false, proof });
      book.state.income.push({ entryId: e.id, wallet: w.id, date, year, sats: e.sats, valueCents: e.valueCents, description: src.description ?? null });
      return null;
    case 'gift': {
      const costKnown = src.giverCostCents !== undefined;
      const costCents = src.giverCostCents ?? 0;
      const acquiredAt = src.giverAcquiredAt ?? e.at;
      const dualBasis = costKnown && e.valueCents < costCents;
      newLot(book, e, w.id, { costCents, acquiredAt, tier: e.tier ?? (costKnown ? 'documented' : 'unknown'), alwaysLongTerm: false, proof });
      book.state.giftsReceived.push({ entryId: e.id, wallet: w.id, date, year, sats: e.sats, valueCents: e.valueCents, costCents, costKnown, acquiredDate: localDate(acquiredAt, e.tz), dualBasis });
      if (dualBasis) book.state.cpaFlags.push({ entryId: e.id, code: 'dual-basis', message: "Gift worth less than the giver's cost (dual basis): confirm with your CPA." });
      return null;
    }
    case 'inherited':
      newLot(book, e, w.id, { costCents: e.valueCents, acquiredAt: e.at, tier, alwaysLongTerm: true, proof });
      return null;
    case 'frozen-payout': {
      const from = book.wallets.get(src.fromWallet);
      if (from === undefined) return problem('unknown-wallet', `wallet ${src.fromWallet} does not exist`);
      if (!from.frozen) return problem('not-frozen', `${from.name} is not frozen`);
      newLot(book, e, w.id, { costCents: e.valueCents, acquiredAt: e.at, tier, alwaysLongTerm: false, proof });
      const closeOut = book.closeOuts.get(from.id);
      if (closeOut === undefined) {
        from.recoveredCents += e.valueCents;
      } else {
        book.state.recoveries.push({ entryId: e.id, wallet: w.id, fromWallet: from.id, closeOutEntryId: closeOut.entryId, date, year, sats: e.sats, gainCents: e.valueCents, term: closeOut.recoveryTerm });
      }
      return null;
    }
  }
}

export function applyMove(book: Book, e: MoveEntry, date: LocalDate): Problem | null {
  const from = activeWallet(book, e.from);
  if (isProblem(from)) return from;
  const to = activeWallet(book, e.to);
  if (isProblem(to)) return to;
  const bad = checkPicks(book, from.id, e.picks, e.sats + e.feeSats);
  if (bad !== null) return bad;
  const { moved, fee } = splitMovePicks(e.picks, e.sats);
  e.picks.forEach((p, i) => {
    const sats = moved[i] as number;
    if (sats === 0) return;
    const src = book.lots.get(p.lotId) as Lot;
    const piece = takeFromLot(book, p.lotId, sats, date);
    addLot(book, { ...src, id: `${e.id}:${i}`, wallet: to.id, sats, costCents: piece.costCents });
  });
  const feePieces = e.picks.flatMap((p, i) => ((fee[i] as number) > 0 ? [takeFromLot(book, p.lotId, fee[i] as number, date)] : []));
  if (feePieces.length > 0) book.state.disposals.push(makeDisposal(e, 'fee', from.id, date, feePieces, e.feeValueCents, null));
  touch(book, from.id, e.id);
  touch(book, to.id, e.id);
  return null;
}

export function applySell(book: Book, e: SellEntry, date: LocalDate): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  const bad = checkPicks(book, w.id, e.picks, e.sats);
  if (bad !== null) return bad;
  const pieces = e.picks.map((p) => takeFromLot(book, p.lotId, p.sats, date));
  book.state.disposals.push(makeDisposal(e, e.spent ? 'spend' : 'sell', w.id, date, pieces, e.proceedsCents, e.description ?? null));
  touch(book, w.id, e.id);
  return null;
}

export function applyGive(book: Book, e: GiveEntry, date: LocalDate): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  const bad = checkPicks(book, w.id, e.picks, e.sats);
  if (bad !== null) return bad;
  const pieces = e.picks.map((p) => takeFromLot(book, p.lotId, p.sats, date));
  const values = splitProportional(e.valueCents, pieces.map((p) => p.sats));
  const picks = pieces.map((p, i) => ({ ...p, valueCents: values[i] as number }));
  const gift: GiftGiven = { entryId: e.id, wallet: w.id, recipient: e.recipient, date, year: yearOf(date), sats: e.sats, valueCents: e.valueCents, costCents: sum(picks.map((p) => p.costCents)), picks };
  if (e.to === 'person') {
    book.state.gifts.push(gift);
  } else {
    const deductionCents = sum(picks.map((p) => (p.term === 'long' ? p.valueCents : Math.min(p.costCents, p.valueCents))));
    book.state.charityGifts.push({ ...gift, deductionCents, appraisalFlag: false });
  }
  touch(book, w.id, e.id);
  return null;
}

export function applyLost(book: Book, e: LostEntry, date: LocalDate): Problem | null {
  const w = activeWallet(book, e.wallet);
  if (isProblem(w)) return w;
  const bad = checkPicks(book, w.id, e.picks, e.sats);
  if (bad !== null) return bad;
  const picks = e.picks.map((p) => takeFromLot(book, p.lotId, p.sats, date));
  book.state.lost.push({ entryId: e.id, wallet: w.id, cause: e.cause, date, year: yearOf(date), sats: e.sats, costCents: sum(picks.map((p) => p.costCents)), picks });
  book.state.cpaFlags.push({ entryId: e.id, code: 'lost-coins', message: 'Lost coins: no deduction recorded. Ask your CPA whether any loss can be claimed.' });
  touch(book, w.id, e.id);
  return null;
}

export function applyCloseOut(book: Book, e: WalletCloseOutEntry, date: LocalDate): Problem | null {
  const w = book.wallets.get(e.wallet);
  if (w === undefined) return problem('unknown-wallet', `wallet ${e.wallet} does not exist`);
  if (!w.frozen) return problem('not-frozen', `${w.name} must be frozen before close-out`);
  if (w.closeOutEntryId !== null) return problem('already-closed-out', `${w.name} was already closed out`);
  const lots = oldestFirstOrder([...book.lots.values()], w.id);
  if (lots.length === 0) return problem('nothing-to-close-out', `${w.name} holds no coins`);
  const lossDate = e.lossDate ?? date;
  const totalCost = sum(lots.map((l) => l.costCents));
  const shares = splitProportional(w.recoveredCents, lots.map((l) => (totalCost > 0 ? l.costCents : l.sats)));
  const pieces = lots.map((l, i) => {
    const recoveredCents = shares[i] as number;
    const piece = { lotId: l.id, sats: l.sats, costCents: l.costCents, acquiredDate: l.acquiredDate, tier: l.tier, term: termFor(l, lossDate), recoveredCents, gainCents: recoveredCents - l.costCents };
    l.sats = 0;
    l.costCents = 0;
    return piece;
  });
  const termCost = (term: 'short' | 'long'): number => sum(pieces.filter((p) => p.term === term).map((p) => p.costCents));
  const termGain = (term: 'short' | 'long'): number => sum(pieces.filter((p) => p.term === term).map((p) => p.gainCents));
  const closeOut: CloseOut = {
    entryId: e.id,
    wallet: w.id,
    lossDate,
    year: yearOf(lossDate),
    sats: sum(pieces.map((p) => p.sats)),
    costCents: totalCost,
    recoveredCents: w.recoveredCents,
    gainCents: w.recoveredCents - totalCost,
    stGainCents: termGain('short'),
    ltGainCents: termGain('long'),
    recoveryTerm: termCost('long') > termCost('short') ? 'long' : 'short',
    pieces,
  };
  w.closeOutEntryId = e.id;
  book.closeOuts.set(w.id, closeOut);
  book.state.closeOuts.push(closeOut);
  touch(book, w.id, e.id);
  return null;
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

/** Apply any entry kind. */
export function applyEntry(book: Book, e: Entry, date: LocalDate): Problem | null {
  switch (e.kind) {
    case 'wallet':
      if (book.wallets.has(e.wallet)) return problem('wallet-exists', `wallet ${e.wallet} already exists`);
      book.wallets.set(e.wallet, { id: e.wallet, name: e.name, type: e.type, defaultProof: e.defaultProof, archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0 });
      return null;
    case 'wallet-update': {
      const w = book.wallets.get(e.wallet);
      if (w === undefined) return problem('unknown-wallet', `wallet ${e.wallet} does not exist`);
      if (e.name !== undefined) w.name = e.name;
      if (e.archived !== undefined) w.archived = e.archived;
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
    case 'giving-paid':
      book.state.givingPaid.push({ entryId: e.id, year: e.year, cents: e.cents });
      return null;
    case 'close-year':
    case 'unlock-year':
    case 'delete':
      return null;
  }
}
