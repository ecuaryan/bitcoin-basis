import type { Holdings, LedgerState } from '@bitcoin-basis/engine';

/** A wallet that has not been checked for this many days (or ever) gets one gentle reminder. */
export const NUDGE_DAYS = 60;
/** localStorage key: the date until which the reminder stays quiet. Only a date; no wallet, amount or name. */
export const NUDGE_KEY = 'bb.nudge-until';

export interface BalanceNudge {
  walletId: string;
  walletName: string;
  /** The last matching check (`YYYY-MM-DD`), or null if there never was one. */
  lastChecked: string | null;
}

const dayMs = 86_400_000;
const dayNumber = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / dayMs);

/** `date` plus `days` days, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * dayMs).toISOString().slice(0, 10);
}

/**
 * The one wallet to ask about: live (not archived, frozen or retirement), holding coins, and not matched in 60+ days.
 * Never-checked wallets come first (largest first), then the longest wait.
 */
export function balanceNudge(state: LedgerState, h: Holdings, today: string): BalanceNudge | null {
  const due: BalanceNudge[] = [];
  const size = new Map<string, number>();
  for (const w of h.wallets) {
    if (w.type === 'retirement' || w.archived || w.frozen || w.sats <= 0) continue;
    const last = state.balanceChecks.filter((c) => c.wallet === w.wallet && c.matches).reduce<string | null>((best, c) => (best === null || c.date > best ? c.date : best), null);
    if (last !== null && dayNumber(today) - dayNumber(last) < NUDGE_DAYS) continue;
    due.push({ walletId: w.wallet, walletName: w.name, lastChecked: last });
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

/** Dismiss the reminder for the next 60 days. */
export function snoozeNudge(today: string, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(NUDGE_KEY, addDays(today, NUDGE_DAYS));
  } catch {
    // Storage blocked: it comes back next visit.
  }
}
