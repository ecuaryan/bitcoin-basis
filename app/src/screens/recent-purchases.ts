import type { Cents, Sats, Tier } from '@bitcoin-basis/engine';
import type { EntryItem, EntryRun } from '../lib/entry-list.ts';
import { localInputFor } from './log/model.ts';

/** One purchase for Holdings' table: a logged buy, a retirement purchase, or an imported lot that cost something. */
export interface PurchaseRow {
  run: EntryRun;
  /** When the Bitcoin was bought (an imported lot's own date, not the day it was imported). */
  at: string;
  /** Local date of `at`, in the entry's time zone. */
  date: string;
  wallet: string;
  sats: Sats;
  costCents: Cents;
  /** Null for retirement purchases, which have no tier. */
  tier: Tier | null;
  retirement: boolean;
}

/**
 * Every purchase, newest first by when it was bought. Imported lots count (most purchases arrive that way) unless they
 * cost nothing; removed entries and unresolved edits do not.
 */
export function recentPurchases(items: readonly EntryItem[]): PurchaseRow[] {
  const rows: PurchaseRow[] = [];
  for (const item of items) {
    if (item.deleted || item.conflict) continue;
    const e = item.current;
    const run: EntryRun = { item, count: 1, items: [item], net: null };
    if (e.kind === 'buy') rows.push({ run, at: e.at, date: localInputFor(e.at, e.tz).slice(0, 10), wallet: e.wallet, sats: e.sats, costCents: e.costCents, tier: e.tier, retirement: false });
    else if (e.kind === 'opening-lot' && e.costCents > 0) rows.push({ run, at: e.acquiredAt, date: localInputFor(e.acquiredAt, e.tz).slice(0, 10), wallet: e.wallet, sats: e.sats, costCents: e.costCents, tier: e.tier, retirement: false });
    else if (e.kind === 'retirement-buy') rows.push({ run, at: e.at, date: localInputFor(e.at, e.tz).slice(0, 10), wallet: e.wallet, sats: e.sats, costCents: e.costCents, tier: null, retirement: true });
  }
  const time = (r: PurchaseRow) => Date.parse(r.at);
  return rows.sort((a, b) => time(b) - time(a) || (a.run.item.id < b.run.item.id ? 1 : -1));
}
