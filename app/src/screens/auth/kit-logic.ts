import type { Wallet, WalletType } from '@bitcoin-basis/engine';

export const WALLET_TYPE_LABEL: Record<WalletType, string> = {
  exchange: 'Exchange',
  'self-custody': 'Self-custody',
  retirement: 'Retirement',
};

export interface KitWalletRow {
  readonly name: string;
  readonly type: string;
}

/** Names and types only. No keys, no amounts, no addresses. Archived wallets are left off. */
export function kitWalletRows(wallets: readonly Wallet[]): KitWalletRow[] {
  return wallets.filter((w) => !w.archived).map((w) => ({ name: w.name, type: WALLET_TYPE_LABEL[w.type] }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` to "Nov 20, 2026". */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  return `${MONTHS[m - 1] ?? ''} ${d}, ${y}`;
}

/** The same day one year later (Feb 29 becomes Feb 28), `YYYY-MM-DD`. */
export function oneYearLater(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const leapDay = m === 2 && d === 29;
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(leapDay ? 28 : d).padStart(2, '0')}`;
}

export const KIT_STEPS: readonly string[] = [
  "Point a phone's camera at the square code below and tap the link. (No phone handy? Open the app address below in a browser.)",
  'Choose “Open my records”. The scan fills in the code; otherwise type the code below.',
  "The records open. Set up your own passkey (your fingerprint, face or screen lock) when it asks, so you won't need the code again.",
  'Show the tax preparer Tax season, and download “For my CPA”.',
];
