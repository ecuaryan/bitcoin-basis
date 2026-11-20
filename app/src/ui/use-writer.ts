import type { Entry } from '@bitcoin-basis/engine';
import { useCallback } from 'react';
import { useLedger } from '../data/ledger-provider.tsx';
import { entryInstant, newIdGenerator } from './new-entry.ts';

type Distribute<T> = T extends Entry ? Omit<T, 'id' | 'at' | 'tz'> : never;
/** An entry without the fields the writer fills in. */
export type EntryDraft = Distribute<Entry>;

/** Adds entries stamped with a fresh id, the time now and the book's time zone. Never mutates anything. */
export function useWriter(): (draft: EntryDraft) => Promise<Entry> {
  const { entries, state, isDemo, today, append } = useLedger();
  const zone = state.settings.timeZone;
  return useCallback(
    async (draft) => {
      const entry = { ...draft, id: newIdGenerator(entries)(), at: entryInstant(isDemo, today), tz: zone } as Entry;
      await append([entry]);
      return entry;
    },
    [entries, isDemo, today, zone, append],
  );
}
