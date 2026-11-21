import { isRecheck, walletsOf, type EntryItem } from '../../lib/entry-list.ts';
import { localDate, type Entry, type LedgerState, type Lot, type Wallet } from '@bitcoin-basis/engine';

/** Entries (newest versions only, the ones that count) that touch this wallet, newest first. For logic; lists use `entryRows`. */
export function walletEntries(entries: readonly Entry[], state: LedgerState, walletId: string): Entry[] {
  const applied = new Set(state.applied);
  return entries
    .filter((e) => applied.has(e.id) && walletsOf(e).includes(walletId))
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

export interface CheckDay {
  date: string;
  /** Checks made that day (re-checks included). */
  times: number;
  matched: boolean;
}

/**
 * Every day this wallet's balance was confirmed, newest first. Balance confirmations are not listed with the entries;
 * this is their only history. A re-check replaces the last check, so the older version still counts as a match.
 */
export function checkHistory(items: readonly EntryItem[], state: LedgerState, walletId: string): CheckDay[] {
  const result = new Map(state.balanceChecks.map((c) => [c.entryId, c.matches]));
  const days = new Map<string, CheckDay>();
  for (const item of items) {
    const e = item.current;
    if (item.deleted || e.kind !== 'balance-confirm' || e.wallet !== walletId) continue;
    for (const v of item.versions) {
      if (v.kind !== 'balance-confirm') continue;
      const date = localDate(v.at, v.tz);
      const matched = result.get(v.id) ?? isRecheck(item.versions[item.versions.indexOf(v) + 1] ?? v);
      const day = days.get(date);
      if (day === undefined) days.set(date, { date, times: 1, matched });
      else days.set(date, { date, times: day.times + 1, matched: day.matched && matched });
    }
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
