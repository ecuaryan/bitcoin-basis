import { taxYear, type Entry, type Holdings, type LedgerState } from '@bitcoin-basis/engine';
import { walletsOf } from './entry-list.ts';

/** A wallet that has not been confirmed for this many days (or ever) gets one gentle reminder. */
export const NUDGE_DAYS = 90;
/** Not now keeps the reminder quiet for this many days. */
export const SNOOZE_DAYS = 30;
/** Tax season (Jan 1 to Apr 15): a wallet used last year and not confirmed since Jan 1 is asked about once. */
const TAX_SEASON_END = '04-15';
/** localStorage key: the date until which the reminder stays quiet. Only a date; no wallet, amount or name. */
export const NUDGE_KEY = 'bb.nudge-until';

export interface BalanceNudge {
  walletId: string;
  walletName: string;
  /** The last matching check (`YYYY-MM-DD`), or null if there never was one. */
  lastChecked: string | null;
  /** Why now: not confirmed in 90 days, or tax season for a wallet used last year. */
  why: 'stale' | 'tax-season';
}

const dayMs = 86_400_000;
const dayNumber = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / dayMs);

/** `date` plus `days` days, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * dayMs).toISOString().slice(0, 10);
}

/** Wallets with something logged (other than a balance check) in `year`. */
function usedIn(entries: readonly Entry[], applied: ReadonlySet<string>, year: number): Set<string> {
  const used = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'balance-confirm' || !applied.has(e.id) || taxYear(e.at, e.tz) !== year) continue;
    for (const w of walletsOf(e)) used.add(w);
  }
  return used;
}

/**
 * The one wallet to ask about: live (not archived, frozen or retirement), holding coins, and either not matched in
 * 90+ days, or (Jan 1 to Apr 15) used last year and not matched since Jan 1. Never-checked wallets come first (largest
 * first), then the longest wait.
 */
export function balanceNudge(state: LedgerState, h: Holdings, today: string, entries: readonly Entry[] = []): BalanceNudge | null {
  const due: BalanceNudge[] = [];
  const size = new Map<string, number>();
  const year = Number(today.slice(0, 4));
  const season = today.slice(5) <= TAX_SEASON_END;
  const usedLastYear = season ? usedIn(entries, new Set(state.applied), year - 1) : new Set<string>();
  for (const w of h.wallets) {
    if (w.type === 'retirement' || w.archived || w.frozen || w.sats <= 0) continue;
    const last = state.balanceChecks.filter((c) => c.wallet === w.wallet && c.matches).reduce<string | null>((best, c) => (best === null || c.date > best ? c.date : best), null);
    const stale = last === null || dayNumber(today) - dayNumber(last) >= NUDGE_DAYS;
    const taxSeason = usedLastYear.has(w.wallet) && (last === null || last < `${year}-01-01`);
    if (!stale && !taxSeason) continue;
    due.push({ walletId: w.wallet, walletName: w.name, lastChecked: last, why: stale ? 'stale' : 'tax-season' });
    size.set(w.wallet, w.sats);
  }
  due.sort((a, b) => {
    if (a.lastChecked === null && b.lastChecked !== null) return -1;
    if (b.lastChecked === null && a.lastChecked !== null) return 1;
    if (a.lastChecked !== null && b.lastChecked !== null && a.lastChecked !== b.lastChecked) return a.lastChecked < b.lastChecked ? -1 : 1;
    return (size.get(b.walletId) ?? 0) - (size.get(a.walletId) ?? 0);
  });
  return due[0] ?? null;
}

/** Is the reminder asleep? (It was dismissed and the quiet period has not ended.) */
export function nudgeSnoozed(today: string, storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
  try {
    const until = storage.getItem(NUDGE_KEY);
    return until !== null && /^\d{4}-\d{2}-\d{2}$/.test(until) && today < until;
  } catch {
    return false;
  }
}

/** Dismiss the reminder for the next 30 days. */
export function snoozeNudge(today: string, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(NUDGE_KEY, addDays(today, SNOOZE_DAYS));
  } catch {
    // Storage blocked: it comes back next visit.
  }
}
