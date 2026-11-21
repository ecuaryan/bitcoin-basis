import type { Entry, LedgerState } from '@bitcoin-basis/engine';
import { useCallback } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { entryInstant, newIdGenerator } from '../../ui/new-entry.ts';
import type { EntryDraft } from '../../ui/use-writer.ts';
import { noonOn, trialReplay } from '../log/model.ts';

/** A loan record to save, and the day it happened on (default today). */
export interface LoanDraft {
  draft: EntryDraft;
  date?: string;
}

/**
 * Turns loan drafts into entries (fresh ids, the book's time zone, dated noon on their day or now for today) and says
 * what would break before anything is saved. Several drafts become one save.
 */
export function useLoanWriter(): { make(drafts: readonly LoanDraft[]): { entries: Entry[]; problems: string[]; after: LedgerState }; save(made: readonly Entry[]): Promise<void> } {
  const { entries, state, isDemo, today, append } = useLedger();
  const tz = state.settings.timeZone;
  const make = useCallback(
    (drafts: readonly LoanDraft[]) => {
      const nextId = newIdGenerator(entries);
      const now = entryInstant(isDemo, today);
      const made = drafts.map(({ draft, date }) => {
        const at = date === undefined || date === today ? now : (noonOn(date, tz) ?? now);
        return { ...draft, id: nextId(), at, tz } as Entry;
      });
      const replacing = made.find((e) => e.replaces !== undefined && e.kind !== 'delete')?.replaces;
      const trial = trialReplay(entries, state, made, replacing);
      return { entries: made, problems: trial.problems, after: trial.after };
    },
    [entries, state, isDemo, today, tz],
  );
  const save = useCallback((made: readonly Entry[]) => append(made), [append]);
  return { make, save };
}
