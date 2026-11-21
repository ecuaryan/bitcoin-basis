import type { Entry } from '@bitcoin-basis/engine';
import { useCallback } from 'react';
import { useLedger } from '../data/ledger-provider.tsx';
import { entryInstant, newIdGenerator } from './new-entry.ts';

type Distribute<T> = T extends Entry ? Omit<T, 'id' | 'at' | 'tz'> : never;
/** An entry without the fields the writer fills in. */
export type EntryDraft = Distribute<Entry>;

/**
 * Adds entries stamped with a fresh id, the time now and the book's time zone. Never mutates anything. A settings change
 * that changes nothing is not written (resolves to null), unless `evenIfSame`: a first choice of filing status or state
 * must be recorded even when it matches the built-in default (Idaho, single), or it would still show as not set.
 */
export function useWriter(): (draft: EntryDraft, opts?: { evenIfSame?: boolean }) => Promise<Entry | null> {
  const { entries, state, isDemo, today, append } = useLedger();
  const zone = state.settings.timeZone;
  return useCallback(
    async (draft, opts) => {
      if (draft.kind === 'settings' && opts?.evenIfSame !== true) {
        const now = state.settings as unknown as Record<string, unknown>;
        const patch = draft.patch as Record<string, unknown>;
        if (Object.keys(patch).every((k) => JSON.stringify(patch[k]) === JSON.stringify(now[k]))) return null;
      }
      const entry = { ...draft, id: newIdGenerator(entries)(), at: entryInstant(isDemo, today), tz: zone } as Entry;
      await append([entry]);
      return entry;
    },
    [entries, state.settings, isDemo, today, zone, append],
  );
}
