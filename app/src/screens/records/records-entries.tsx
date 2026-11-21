import { useDeferredValue, useMemo, useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { buildItems, entryRows, entryYears, KIND_GROUPS, NO_FILTER, type EntryFilter, type KindGroup } from '../../lib/entry-list.ts';
import { countOf } from '../../lib/format.ts';
import { Field, SelectBox } from '../../ui/Field.tsx';
import { EmptyLine, SectionCount, SectionHeader, ShowMore } from '../../ui/SectionHeader.tsx';
import { EntryRow, EntrySheet } from '../entry-parts.tsx';

const PAGE = 40;

/** `9 entries` (the rows the list shows). */
export const entriesCount = (n: number): string => countOf(n, 'entry', 'entries');

export function EntriesView({ autoFocusSearch = false }: { autoFocusSearch?: boolean }) {
  const { entries, state, today } = useLedger();
  const items = useMemo(() => buildItems(entries), [entries]);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const [filter, setFilter] = useState<EntryFilter>(NO_FILTER);
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const deferred = useDeferredValue(filter);
  const years = useMemo(() => entryYears(items), [items]);
  const rows = useMemo(() => entryRows(items, deferred, wallets), [items, deferred, wallets]);
  const base = useMemo(() => entryRows(items, NO_FILTER, wallets).length, [items, wallets]);
  const open = rows.find((r) => r.item.id === openId) ?? null;
  const set = (patch: Partial<EntryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const filtered = deferred.text.trim() !== '' || deferred.wallet !== '' || deferred.group !== '' || deferred.year !== '';
  return (
    <div className="flex flex-col gap-3">
      <Field label="Search entries" type="search" className="lg:max-w-[480px]" value={filter.text} onChange={(e) => set({ text: e.target.value })} placeholder="Wallet, note, kind…" autoFocus={autoFocusSearch} />
      <div className="grid grid-cols-3 gap-2">
        <SelectBox label="Wallet" value={filter.wallet} onChange={(e) => set({ wallet: e.target.value })}>
          <option value="">All</option>
          {state.wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectBox>
        <SelectBox label="Kind" value={filter.group} onChange={(e) => set({ group: e.target.value as KindGroup | '' })}>
          <option value="">All</option>
          {KIND_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </SelectBox>
        <SelectBox label="Year" value={filter.year} onChange={(e) => set({ year: e.target.value })}>
          <option value="">All</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </SelectBox>
      </div>
      <section aria-label="Entries" className="flex flex-col">
        <SectionHeader title={filtered ? 'Matching entries' : 'Entries'} right={<SectionCount>{filtered ? `${rows.length} of ${entriesCount(base)}` : entriesCount(rows.length)}</SectionCount>} />
        {rows.length === 0 ? (
          <EmptyLine className="rounded-[18px] border border-line bg-surface px-4">{filtered ? 'Nothing matches. Clear a filter or try other words.' : 'Nothing logged yet.'}</EmptyLine>
        ) : (
          <ul className="m-0 list-none rounded-[18px] border border-line bg-surface px-3.5 py-0.5">
            {rows.slice(0, shown).map((run, i, arr) => (
              <EntryRow key={run.item.id} run={run} wallets={wallets} today={today} onOpen={() => setOpenId(run.item.id)} last={i === arr.length - 1} />
            ))}
          </ul>
        )}
        {rows.length > shown && <ShowMore onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</ShowMore>}
      </section>
      {open && <EntrySheet run={open} state={state} today={today} onClose={() => setOpenId(null)} />}
    </div>
  );
}
