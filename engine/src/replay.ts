/** Replay: entries in, ledger state out. Deterministic, pure, never throws for bad entries. */
import type { Book } from './book.ts';
import { DEFAULT_TIME_ZONE, localDate } from './dates.ts';
import { applyEntry } from './handlers.ts';
import { compareEntries } from './order.ts';
import type { Entry, LedgerState, Settings } from './types.ts';
import { resolveVersions } from './versions.ts';

/** Charity gifts above this total value in one year need a qualified appraisal ($5,000). */
export const APPRAISAL_THRESHOLD_CENTS = 500_000;

export const DEFAULT_SETTINGS: Settings = {
  filingStatus: 'single',
  wagesCents: 0,
  state: { kind: 'flat', state: 'ID' },
  carryforwardStCents: 0,
  carryforwardLtCents: 0,
  givingEnabled: false,
  givingName: 'Giving',
  givingPercent: 10,
  givingMode: 'before-tax',
  earlierMoneyInCents: 0,
  timeZone: DEFAULT_TIME_ZONE,
};

function flagAppraisals(state: LedgerState): void {
  const totals = new Map<number, number>();
  for (const g of state.charityGifts) totals.set(g.year, (totals.get(g.year) ?? 0) + g.valueCents);
  for (const g of state.charityGifts) {
    if ((totals.get(g.year) as number) <= APPRAISAL_THRESHOLD_CENTS) continue;
    g.appraisalFlag = true;
    state.cpaFlags.push({ entryId: g.entryId, code: 'qualified-appraisal', message: `Charity gifts in ${g.year} are worth over $5,000: a qualified appraisal is needed.` });
  }
}

/**
 * Replay every entry ever written (any order) into ledger state.
 *
 * Applies edits and deletes (`replaces`), reports conflicts, enforces closed years, then applies
 * the remaining entries in order of `at`, then `id` (wallet creations first), using each
 * disposal's saved picks. Entries
 * that cannot be applied are listed in `errors` and skipped; everything else still replays.
 */
export function replay(entries: readonly Entry[]): LedgerState {
  const resolution = resolveVersions(entries);
  const state: LedgerState = {
    wallets: [],
    lots: [],
    disposals: [],
    income: [],
    giftsReceived: [],
    gifts: [],
    charityGifts: [],
    lost: [],
    closeOuts: [],
    recoveries: [],
    balanceChecks: [],
    retirementSnapshots: [],
    givingPaid: [],
    conflicts: resolution.conflicts,
    closedYears: resolution.closedYears,
    settings: DEFAULT_SETTINGS,
    buyCostCents: 0,
    cpaFlags: [],
    errors: resolution.errors,
    applied: [],
  };
  const book: Book = { wallets: new Map(), lots: new Map(), closeOuts: new Map(), touched: new Map(), state };
  // Wallets exist for the whole timeline, so a wallet added today can hold coins bought years ago.
  const ordered = [...resolution.applied].sort((a, b) => Number(b.kind === 'wallet') - Number(a.kind === 'wallet') || compareEntries(a, b));
  for (const e of ordered) {
    const problem = applyEntry(book, e, localDate(e.at, e.tz));
    if (problem === null) state.applied.push(e.id);
    else state.errors.push({ entryId: e.id, ...problem });
  }
  flagAppraisals(state);
  state.wallets = [...book.wallets.values()].map((w) => ({ ...w }));
  state.lots = [...book.lots.values()].filter((l) => l.sats > 0).map((l) => ({ ...l }));
  return state;
}
