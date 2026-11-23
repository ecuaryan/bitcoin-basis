import type { Entry, Sats, Wallet } from '@bitcoin-basis/engine';
import { describeEntry, type EntryLine } from './describe-entry.ts';

/** One entry as a row of an entry list (Records, a wallet's Entries): the words and figures each column shows. */
export interface RowLine extends EntryLine {
  /** A retirement purchase: titled `Bought`, with a Retirement tag. */
  retirement: boolean;
  /**
   * On a wallet page, a move out of that wallet: what arrived in the other wallet. `sats` is then what left this wallet
   * (arrived plus the network fee, as the wallet's balance counts it) and the fee goes with this in the note.
   */
  arrivedSats: Sats | null;
  /** What the dollars were, in a list: `paid`, `received`, `worth then`. Empty without dollars. */
  centsWord: string;
}

/** `worth` alone could read as worth now: a list says it was the value on the entry's day. */
const centsWord = (label: string): string => (label === 'worth' ? 'worth then' : label);

/**
 * `describeEntry` for a list row. With `walletId` (a wallet's own Entries) the figures are what that wallet saw: a move
 * out shows what left (coins plus fee, signed −) and is titled `Moved to …`; a move in shows what arrived (+) and is
 * titled `Moved from …` (the title names the other wallet, so the row's wallet is this one); a payout out of a frozen wallet leaves that wallet's coins as they were (no sign).
 */
export function rowLine(e: Entry, wallets: ReadonlyMap<string, Wallet>, loans: ReadonlyMap<string, string>, walletId: string | null = null): RowLine {
  const line = describeEntry(e, wallets, loans);
  const name = (id: string): string => wallets.get(id)?.name ?? 'Unknown wallet';
  const row: RowLine = { ...line, retirement: e.kind === 'retirement-buy', arrivedSats: null, centsWord: centsWord(line.centsLabel) };
  if (row.retirement) row.title = 'Bought';
  if (walletId === null) return row;
  if (e.kind === 'move' && e.from === walletId) {
    const fee = e.feeSats > 0;
    return { ...row, title: `Moved to ${name(e.to)}`, wallets: [name(walletId)], sats: e.sats + e.feeSats, sign: '−', arrivedSats: fee ? e.sats : null, feeSats: fee ? e.feeSats : null };
  }
  if (e.kind === 'move' && e.to === walletId) return { ...row, title: `Moved from ${name(e.from)}`, wallets: [name(walletId)], sign: '+', feeSats: null };
  if (e.kind === 'receive' && e.source.type === 'frozen-payout' && e.source.fromWallet === walletId && e.wallet !== walletId) {
    return { ...row, title: `Paid out to ${name(e.wallet)}`, sign: '', note: '' };
  }
  return row;
}
