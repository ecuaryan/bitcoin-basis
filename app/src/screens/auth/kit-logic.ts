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

/** The same day one year later (Feb 29 becomes Feb 28), `YYYY-MM-DD`. */
export function oneYearLater(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const leapDay = m === 2 && d === 29;
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(leapDay ? 28 : d).padStart(2, '0')}`;
}

/** The kit's steps. With a code printed, the square code fills it in; without one, it only opens the app. */
export function kitSteps(hasCode: boolean): readonly string[] {
  return [
    "Scan the square code below with a phone's camera and open the link. No phone? Type the app address below into a web browser.",
    hasCode
      ? 'If you scanned, the code is already filled in: tap “Restore my records”. If you typed the address, choose “I already use Bitcoin Basis” and type the code below.'
      : 'Choose “I already use Bitcoin Basis” and type the recovery code written below.',
    'When it asks, add a passkey (fingerprint, face or screen lock) so you won’t need the code again. If it offers a new recovery code, take it and print a new kit.',
    'For taxes, open “Tax season” and download “For my CPA”.',
  ];
}
