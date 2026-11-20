/** Prepare-sale: the move that makes a later sale from an exchange legal. */
import { sum } from '../book.ts';
import type { Cents } from '../money.ts';
import { validatePicks } from '../picks.ts';
import { err, ok } from '../result.ts';
import { canSellFrom } from '../sell-guard.ts';
import type { LedgerState, LotPick, MoveEntry, PickErrorCode, Result, WalletId } from '../types.ts';

export interface PrepareSaleRequest {
  readonly fromWallet: WalletId;
  readonly toWallet: WalletId;
  /** The coins to move (including any fee coins). */
  readonly picks: readonly LotPick[];
  /** Network fee in sats, taken from the picks after the moved coins (default 0). */
  readonly feeSats?: number;
  readonly feeValueCents?: Cents;
}

export type PrepareSaleError = { code: PickErrorCode | 'unknown-wallet' | 'same-wallet' | 'cannot-sell-from-destination' | 'wallet-unavailable'; message: string };

/** A move entry without id, time or zone (the caller adds them). After logging it, sell the lots `picksAfterMove(id, picks, sats)` names. */
export type MoveDraft = Omit<MoveEntry, 'id' | 'at' | 'tz'>;

export function planPrepareSale(state: LedgerState, req: PrepareSaleRequest): Result<MoveDraft, PrepareSaleError> {
  const from = state.wallets.find((w) => w.id === req.fromWallet);
  const to = state.wallets.find((w) => w.id === req.toWallet);
  if (from === undefined || to === undefined) return err({ code: 'unknown-wallet', message: 'wallet does not exist' });
  if (from.id === to.id) return err({ code: 'same-wallet', message: 'a move needs two different wallets' });
  if (from.frozen || from.type === 'retirement') return err({ code: 'wallet-unavailable', message: `${from.name} cannot be moved from` });
  const dest = canSellFrom(to);
  if (!dest.ok) return err({ code: 'cannot-sell-from-destination', message: `${to.name} cannot be sold from: ${dest.error.message}` });
  const feeSats = req.feeSats ?? 0;
  const total = sum(req.picks.map((p) => p.sats));
  const valid = validatePicks(state.lots, from.id, req.picks, total);
  if (!valid.ok) return err(valid.error);
  if (feeSats >= total) return err({ code: 'invalid-amount', message: 'the fee must be less than the coins moved' });
  return ok({ kind: 'move', from: from.id, to: to.id, sats: total - feeSats, feeSats, feeValueCents: req.feeValueCents ?? 0, picks: req.picks });
}
