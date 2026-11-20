import type { Entry, Lot, Tier, Wallet } from '@bitcoin-basis/engine';

export const TIER_LABEL: Record<Tier, string> = {
  documented: 'Documented',
  reconstructed: 'Reconstructed',
  estimated: 'Estimated',
  unknown: 'Unknown',
};

export const TIER_HELP: Record<Tier, string> = {
  documented: 'A receipt or export backs this up.',
  reconstructed: 'Rebuilt from statements or other records.',
  estimated: 'A best guess; worth firming up.',
  unknown: 'No record of the cost yet.',
};

/** Where a coin came from, in plain words, from the entry that first created it. */
export function describeOrigin(lot: Lot, entry: Entry | undefined, wallets: ReadonlyMap<string, Wallet>): string {
  if (!entry) return 'Origin entry not found';
  switch (entry.kind) {
    case 'buy':
      return 'Bought';
    case 'opening-lot':
      return `Imported: ${entry.origin}`;
    case 'receive': {
      const s = entry.source;
      if (s.type === 'income') return s.description ? `Income: ${s.description}` : 'Income';
      if (s.type === 'gift') return 'Gift received';
      if (s.type === 'inherited') return 'Inherited';
      return `Payout from ${wallets.get(s.fromWallet)?.name ?? 'a frozen wallet'}`;
    }
    default:
      return lot.proof;
  }
}
