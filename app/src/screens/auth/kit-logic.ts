import type { Wallet } from '@bitcoin-basis/engine';
import { WALLET_TYPE_LABEL } from '../../lib/wallet-label.ts';

export { WALLET_TYPE_LABEL };

export interface KitWalletRow {
  readonly name: string;
  readonly type: string;
}

/** Names and types only. No keys, no amounts, no addresses. Archived wallets are left off. */
export function kitWalletRows(wallets: readonly Wallet[]): KitWalletRow[] {
  return wallets.filter((w) => !w.archived).map((w) => ({ name: w.name, type: WALLET_TYPE_LABEL[w.type] }));
}

/** `YYYY-MM-DD` to "Nov 20, 2026" (one definition, in lib/format). */
export { longDate } from '../../lib/format.ts';

/** The kit's steps. The square code only opens the app: the recovery code is typed, so it never sits in a link or browser history. */
export const KIT_STEPS: readonly string[] = [
  "Scan the square code below with a phone's camera to open the app. No phone? Type the app address below into a web browser.",
  'Choose “I already use Bitcoin Basis” and type the recovery code below.',
  'When it asks, add a passkey (fingerprint, face or screen lock) so you won’t need the code again.',
  'For taxes, open “Tax season” and download “For my CPA”.',
];
