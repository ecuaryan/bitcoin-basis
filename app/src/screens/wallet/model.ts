import type { Entry, LedgerState, Lot, Wallet } from '@bitcoin-basis/engine';

/** Entries (newest versions only) that touch this wallet, newest first. */
export function walletEntries(entries: readonly Entry[], state: LedgerState, walletId: string): Entry[] {
  const applied = new Set(state.applied);
  const touches = (e: Entry): boolean => {
    switch (e.kind) {
      case 'move':
        return e.from === walletId || e.to === walletId;
      case 'receive':
        return e.wallet === walletId || (e.source.type === 'frozen-payout' && e.source.fromWallet === walletId);
      case 'buy':
      case 'sell':
      case 'give':
      case 'lost':
      case 'balance-confirm':
      case 'opening-lot':
      case 'wallet-update':
      case 'wallet-freeze':
      case 'wallet-close-out':
      case 'retirement-snapshot':
        return e.wallet === walletId;
      default:
        return false;
    }
  };
  return entries
    .filter((e) => applied.has(e.id) && touches(e))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}

export function walletLots(state: LedgerState, walletId: string): Lot[] {
  return state.lots.filter((l) => l.wallet === walletId);
}

/** Date of the last balance check that matched, or null. */
export function lastConfirmed(state: LedgerState, walletId: string): string | null {
  return state.balanceChecks.filter((c) => c.wallet === walletId && c.matches).reduce<string | null>((best, c) => (best === null || c.date > best ? c.date : best), null);
}

export function findWallet(state: LedgerState, id: string | undefined): Wallet | undefined {
  return state.wallets.find((w) => w.id === id);
}

/** Newest first. Back-to-back identical balance checks become one row ("Checked the balance ×3"). */
export function collapseChecks(rows: readonly Entry[]): { entry: Entry; same: Entry[] }[] {
  const out: { entry: Entry; same: Entry[] }[] = [];
  for (const e of rows) {
    const prev = out.at(-1);
    if (prev !== undefined && e.kind === 'balance-confirm' && prev.entry.kind === 'balance-confirm' && prev.entry.sats === e.sats) prev.same.push(e);
    else out.push({ entry: e, same: [e] });
  }
  return out;
}
