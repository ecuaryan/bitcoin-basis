/** Planner-facing checks on where a sale can be planned from. */
import { err, ok } from './result.ts';
import type { Result, Wallet, WalletId } from './types.ts';

export type SellRefusal =
  | { code: 'prepare-sale'; wallet: WalletId; message: string; steps: string[] }
  | { code: 'wallet-frozen'; wallet: WalletId; message: string }
  | { code: 'retirement-wallet'; wallet: WalletId; message: string };

/**
 * Whether the Sell planner may plan a sale from `wallet`. Self-custody wallets get
 * `prepare-sale` guidance: move exactly the chosen lots to an exchange wallet first (logged
 * with picks; see `picksAfterMove`), then sell there. Logging a `sell` with `spent: true` is
 * still allowed from any non-frozen wallet; this check is for the planner only.
 */
export function canSellFrom(wallet: Wallet): Result<true, SellRefusal> {
  if (wallet.type === 'retirement') return err({ code: 'retirement-wallet', wallet: wallet.id, message: `${wallet.name} is a retirement wallet; it is not part of tax planning.` });
  if (wallet.frozen) return err({ code: 'wallet-frozen', wallet: wallet.id, message: `${wallet.name} is frozen; its coins cannot be sold.` });
  if (wallet.type === 'self-custody') {
    return err({
      code: 'prepare-sale',
      wallet: wallet.id,
      message: `Coins in ${wallet.name} must be moved to an exchange before they can be sold.`,
      steps: [
        'Choose the coins to sell here (oldest first or lowest tax).',
        'Log a move of exactly those coins to your exchange wallet, keeping the chosen lots.',
        'Sell the moved coins on the exchange and log the sale from that wallet.',
      ],
    });
  }
  return ok(true);
}
