import { givingDue, yearOf } from '@bitcoin-basis/engine';
import { useMemo, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { formatMoney } from '../../lib/format.ts';
import { useIsWide } from '../../ui/AppShell.tsx';
import { ChevronLeftIcon, SearchIcon } from '../../ui/more-icons.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { EntriesView, EntryRow, EntrySheet } from './records-entries.tsx';
import { GivingView } from './records-giving.tsx';
import { ImportExportView } from './records-io.tsx';
import { ClosedYearsView, WalletsView } from './records-misc.tsx';
import { KitCard } from './records-kit.tsx';
import { buildItems } from './records-logic.ts';
import { useState } from 'react';
import { useTitle } from '../../ui/use-title.ts';
import { ChevronRightIcon } from '../../ui/icons.tsx';

type View = 'entries' | 'giving' | 'closed' | 'wallets' | 'io';
const VIEWS: readonly View[] = ['entries', 'giving', 'closed', 'wallets', 'io'];

function viewTitle(view: View, givingName: string): string {
  const titles: Record<View, string> = { entries: 'All entries', giving: givingName, closed: 'Closed years', wallets: 'Wallets', io: 'Import and export' };
  return titles[view];
}

function Tile({ to, title, sub, hot, active, className }: { to: string; title: string; sub: string; hot?: boolean; active?: boolean; className?: string }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'press-soft flex min-h-[92px] flex-col justify-between rounded-2xl border bg-surface p-3 text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2',
        active ? 'border-accent' : 'border-line',
        className,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-tight text-balance">{title}</span>
        <ChevronRightIcon size={16} className="-mr-0.5 flex-none text-muted" />
      </span>
      <span className={cx('text-xs', hot ? 'font-semibold text-amber' : 'text-muted')}>{sub}</span>
    </Link>
  );
}

/** Records: every entry and its history, giving, closed years, wallets, import and export, settings. */
export function Records() {
  const wide = useIsWide();
  const { entries, state, holdings, today } = useLedger();
  const [params] = useSearchParams();
  const asked = params.get('v');
  const view: View | null = VIEWS.find((v) => v === asked) ?? null;
  useTitle(view === null ? 'Records' : viewTitle(view, state.settings.givingName));
  const year = yearOf(today);
  const items = useMemo(() => buildItems(entries), [entries]);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const due = useMemo(() => (state.settings.givingEnabled ? givingDue(state, state.settings, year) : null), [state, year]);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;
  const active = holdings.wallets.filter((w) => !w.frozen && !w.archived).length;

  const tiles: ReactNode = (
    <section aria-label="Sections" className={cx('grid gap-2.5', wide ? (state.settings.givingEnabled ? 'grid-cols-5' : 'grid-cols-4') : 'grid-cols-2')}>
      {due !== null && <Tile to="/records?v=giving" title={state.settings.givingName} sub={`${formatMoney(Math.max(0, due.owedCents))} due`} hot={due.owedCents > 0} active={view === 'giving'} />}
      <Tile to="/records?v=closed" title="Closed years" sub={state.closedYears.length === 0 ? 'Lock a year once filed' : `${Math.min(...state.closedYears)} to ${Math.max(...state.closedYears)}`} active={view === 'closed'} />
      <Tile to="/records?v=wallets" title="Wallets" sub={`${active} active`} active={view === 'wallets'} />
      <Tile to="/records?v=io" title={'Import and\u00a0export'} sub="CSV · backup" active={view === 'io'} className={state.settings.givingEnabled ? '' : 'col-span-2 lg:col-span-1'} />
      <Tile to="/records?v=entries" title="All entries" sub={`${items.length} in total`} active={view === 'entries'} className="hidden lg:order-first lg:flex" />
    </section>
  );

  const recent = (
    <section aria-label="Recent entries" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between px-0.5 pb-1.5 pt-1">
        <h2 className="m-0 text-[15px] font-semibold">Recent entries</h2>
        <Link to="/records?v=entries" className="flex min-h-11 items-center text-[13px] font-semibold no-underline">
          All {items.length}
        </Link>
      </div>
      <ul className="m-0 list-none rounded-[18px] border border-line bg-surface px-3.5 py-0.5">
        {items.slice(0, 4).map((item, i, arr) => (
          <EntryRow key={item.id} item={item} wallets={wallets} today={today} onOpen={() => setOpenId(item.id)} last={i === arr.length - 1} />
        ))}
        {items.length === 0 && <li className="py-4 text-sm text-muted">Nothing logged yet.</li>}
      </ul>
    </section>
  );

  let body: ReactNode = null;
  if (view === 'entries') body = <EntriesView autoFocusSearch={params.get('search') === '1'} />;
  if (view === 'giving') body = <GivingView />;
  if (view === 'closed') body = <ClosedYearsView />;
  if (view === 'wallets') body = <WalletsView />;
  if (view === 'io') body = <ImportExportView />;

  const searchButton = (
    <Link to="/records?v=entries&search=1" aria-label="Search entries" className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-soft hover:text-text">
      <SearchIcon />
    </Link>
  );

  // Old links: Settings and Security moved to their own page.
  if (asked === 'settings') return <Navigate to="/settings#taxes" replace />;
  if (asked === 'security') return <Navigate to={`/settings${params.get('rotate') === '1' ? '?rotate=1' : ''}#security`} replace />;
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {wide ? (
        <PageHeader title="Records" />
      ) : view === null ? (
        <PageHeader title="Records" visibleOnPhone>
          {searchButton}
        </PageHeader>
      ) : (
        <div className="flex items-center gap-3">
          <Link to="/records" aria-label="Back to Records" className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-soft hover:text-text">
            <ChevronLeftIcon size={18} />
          </Link>
          <h1 className="m-0 font-display text-xl font-semibold">{viewTitle(view, state.settings.givingName)}</h1>
        </div>
      )}
      {(wide || view === null) && <KitCard today={today} />}
      {(wide || view === null) && tiles}
      {view === null && recent}
      {body}
      {open && <EntrySheet item={open} state={state} today={today} onClose={() => setOpenId(null)} />}
    </div>
  );
}
