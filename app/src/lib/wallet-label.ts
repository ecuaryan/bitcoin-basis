import type { WalletType } from '@bitcoin-basis/engine';

/** The one name for each kind of wallet. */
export const WALLET_TYPE_LABEL: Record<WalletType, string> = { exchange: 'Exchange', 'self-custody': 'Self-custody', retirement: 'Retirement' };

/** What a wallet is, the same words in every list: `Exchange`, `Retirement · kept apart`, `Exchange · frozen`, `Self-custody · archived`. */
export function walletKindLabel(w: { type: WalletType; frozen: boolean; archived: boolean }): string {
  const status = w.frozen ? 'frozen' : w.archived ? 'archived' : w.type === 'retirement' ? 'kept apart' : '';
  return status === '' ? WALLET_TYPE_LABEL[w.type] : `${WALLET_TYPE_LABEL[w.type]} · ${status}`;
}
