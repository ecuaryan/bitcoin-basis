import { localDate, type Entry, type LedgerState, type Wallet } from '@bitcoin-basis/engine';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { countOf, shortDate } from '../../lib/format.ts';
import { TIER_LABEL } from '../../lib/origin.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Field, SelectBox } from '../../ui/Field.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { describeEntry } from '../../lib/describe-entry.ts';
import { buildItems, collapseRuns, entryYears, KIND_GROUPS, matches, type EntryFilter, type EntryItem, type KindGroup } from './records-logic.ts';

const PAGE = 40;

/** One row in an entries list. A button: it opens the entry with its history. */
export function EntryRow({ item, wallets, today, onOpen, last, count = 1, net = null }: { item: EntryItem; wallets: ReadonlyMap<string, Wallet>; today: string; onOpen(): void; last: boolean; count?: number; net?: string | null }) {
  const e = item.current;
  const line = describeEntry(e, wallets);
  const edited = item.versions.length > 1;
  return (
    <li className={cx(!last && 'border-b border-line')}>
      <button type="button" onClick={onOpen} className="flex min-h-[60px] w-full items-center gap-3 bg-transparent py-1.5 text-left text-text">
        <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-[11px] bg-accent/12 text-[15px] font-bold text-amber">
          {line.glyph}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cx('text-sm font-semibold', item.deleted && 'text-muted line-through')}>
            {line.title}
            {count > 1 ? ` ×${count}` : ''}
            {item.deleted && <span className="sr-only"> (deleted)</span>}
          </span>
          <span className="truncate text-xs text-muted">
            {net ?? line.detail} · {shortDate(localDate(e.at, e.tz), today)}
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-0.5">
          <span className="text-sm font-semibold">
            {line.sats !== null ? (
              <>
                {line.sign}
                <Amount sats={line.sats} short interactive={false} />
              </>
            ) : line.cents !== null ? (
              <PlainMoney cents={line.cents} />
            ) : null}
          </span>
          <span className={cx('text-xs', edited || item.conflict ? 'text-amber' : 'text-muted')}>
            {item.conflict ? 'Needs a decision' : edited ? `Edited · ${item.versions.length} versions` : item.deleted ? 'Deleted' : line.sats !== null && line.cents !== null ? <PlainMoney cents={line.cents} /> : ''}
          </span>
        </span>
      </button>
    </li>
  );
}

function facts(e: Entry, name: (id: string) => string): [string, ReactNode][] {
  const coins = (label: string, sats: number): [string, ReactNode] => [label, <Amount key={label} sats={sats} showUnit interactive={false} />];
  const cash = (label: string, cents: number): [string, ReactNode] => [label, <Money key={label} cents={cents} />];
  switch (e.kind) {
    case 'buy':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Paid', e.costCents), ['Documentation', TIER_LABEL[e.tier]]];
    case 'receive':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Value that day', e.valueCents), ['Source', e.source.type]];
    case 'move':
      return [['From', name(e.from)], ['To', name(e.to)], coins('Coins arriving', e.sats), coins('Network fee', e.feeSats), ['Coins used', countOf(e.picks.length, 'batch', 'batches')]];
    case 'sell':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash(e.spent ? 'Value spent' : 'Proceeds', e.proceedsCents), ['Coins used', countOf(e.picks.length, 'batch', 'batches')], ...(e.description ? ([['What for', e.description]] as [string, ReactNode][]) : [])];
    case 'give':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Value that day', e.valueCents), ['To', `${e.recipient} (${e.to})`], ['Coins used', countOf(e.picks.length, 'batch', 'batches')]];
    case 'lost':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), ['Cause', e.cause.replace('-', ' ')]];
    case 'opening-lot':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Cost', e.costCents), ['Documentation', TIER_LABEL[e.tier]], ['Where the record is', e.origin]];
    case 'balance-confirm':
    case 'retirement-snapshot':
      return [['Wallet', name(e.wallet)], coins('Balance', e.sats)];
    case 'giving-paid':
      return [['Year', String(e.year)], cash('Paid', e.cents)];
    case 'close-year':
    case 'unlock-year':
      return [['Year', String(e.year)]];
    default:
      return 'wallet' in e ? [['Wallet', name(e.wallet)]] : [];
  }
}

export function EntrySheet({ item, state, today, onClose }: { item: EntryItem; state: LedgerState; today: string; onClose(): void }) {
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const name = (id: string) => wallets.get(id)?.name ?? 'Unknown wallet';
  const e = item.current;
  const line = describeEntry(e, wallets);
  const rows: [string, ReactNode][] = [
    ['When', `${shortDate(localDate(e.at, e.tz), today)} · ${e.tz.replace('_', ' ')}`],
    ...facts(e, name),
    ...(e.proof ? ([['Receipt', e.proof]] as [string, ReactNode][]) : []),
    ...(e.note ? ([['Note', e.note]] as [string, ReactNode][]) : []),
  ];
  const history = [...item.versions].reverse();
  const problems = state.errors.filter((x) => item.versions.some((v) => v.id === x.entryId));
  return (
    <Sheet open onClose={onClose} title={item.deleted ? `${line.title} (deleted)` : line.title}>
      <div className="flex flex-col gap-4 pb-3">
        {item.conflict && (
          <p className="m-0 rounded-xl border border-accent px-3 py-2 text-[13px] text-amber">Two devices edited this entry. Neither applies until one is deleted.</p>
        )}
        {problems.map((p) => (
          <p key={p.entryId + p.code} className="m-0 rounded-xl border border-line px-3 py-2 text-[13px] text-loss">
            Not counted: {p.message}
          </p>
        ))}
        <dl className="m-0 flex flex-col rounded-2xl border border-line bg-bg px-4 py-1">
          {rows.map(([k, v], i) => (
            <div key={k} className={cx('flex min-h-11 items-center justify-between gap-4 text-sm', i < rows.length - 1 && 'border-b border-line')}>
              <dt className="text-soft">{k}</dt>
              <dd className="m-0 text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <section aria-label="History" className="flex flex-col gap-2">
          <h2 className="m-0 text-[15px] font-semibold">History</h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {history.map((v, i) => {
              const l = describeEntry(v, wallets);
              const isNow = v.id === e.id && !item.deleted && i === 0;
              return (
                <li key={v.id} className="flex flex-col gap-0.5 rounded-xl border border-line bg-bg px-3 py-2 text-sm">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">
                      {v.kind === 'delete' ? 'Deleted' : history.length - i === 1 ? 'First entered' : `Version ${history.length - i}`}
                      {isNow && ' · now'}
                    </span>
                    <span className="text-xs text-muted">{shortDate(localDate(v.at, v.tz), today)}</span>
                  </span>
                  {v.kind !== 'delete' && (
                    <span className="text-xs text-soft">
                      {l.sats !== null && <Amount sats={l.sats} showUnit interactive={false} />}
                      {l.sats !== null && l.cents !== null && ' · '}
                      {l.cents !== null && <PlainMoney cents={l.cents} />}
                    </span>
                  )}
                  {v.reason && <span className="text-xs text-muted">Why: {v.reason}</span>}
                </li>
              );
            })}
          </ol>
          <p className="m-0 text-xs text-muted">Edits and deletes are new entries. The older versions are kept.</p>
        </section>
      </div>
    </Sheet>
  );
}

export function EntriesView({ autoFocusSearch = false }: { autoFocusSearch?: boolean }) {
  const { entries, state, today } = useLedger();
  const items = useMemo(() => buildItems(entries), [entries]);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const [filter, setFilter] = useState<EntryFilter>({ text: '', wallet: '', group: '', year: '' });
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const deferred = useDeferredValue(filter);
  const years = useMemo(() => entryYears(items), [items]);
  const list = useMemo(() => items.filter((i) => matches(i, deferred, wallets)), [items, deferred, wallets]);
  const base = useMemo(() => items.filter((i) => matches(i, { text: '', wallet: '', group: '', year: '' }, wallets)).length, [items, wallets]);
  const rows = useMemo(() => collapseRuns(list, items), [list, items]);
  const open = items.find((i) => i.id === openId) ?? null;
  const set = (patch: Partial<EntryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  return (
    <div className="flex flex-col gap-3">
      <Field label="Search entries" type="search" value={filter.text} onChange={(e) => set({ text: e.target.value })} placeholder="Wallet, note, kind…" autoFocus={autoFocusSearch} />
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
      <p role="status" className="m-0 text-xs text-muted">
        {list.length === base ? `All ${base} entries` : `${list.length} of ${base} entries`}
      </p>
      {list.length === 0 ? (
        <p className="m-0 rounded-[18px] border border-line bg-surface p-4 text-sm text-muted">Nothing matches. Clear a filter or try other words.</p>
      ) : (
        <ul className="m-0 list-none rounded-[18px] border border-line bg-surface px-3.5 py-0.5">
          {rows.slice(0, shown).map(({ item, count, net }, i, arr) => (
            <EntryRow key={item.id} item={item} count={count} net={net} wallets={wallets} today={today} onOpen={() => setOpenId(item.id)} last={i === arr.length - 1} />
          ))}
        </ul>
      )}
      {list.length > shown && (
        <Button className="self-center" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, list.length - shown)} more
        </Button>
      )}
      {open && <EntrySheet item={open} state={state} today={today} onClose={() => setOpenId(null)} />}
    </div>
  );
}
