import { givingDue, yearOf } from '@bitcoin-basis/engine';
import { useMemo, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { useIsWide } from '../../ui/AppShell.tsx';
import { ChevronLeftIcon, SearchIcon } from '../../ui/more-icons.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { EntriesView, entriesCount } from './records-entries.tsx';
import { EntryRow, EntrySheet } from '../entry-parts.tsx';
import { EmptyLine, SectionHeader, SectionLink } from '../../ui/SectionHeader.tsx';
import { GivingView } from './records-giving.tsx';
import { ImportExportView } from './records-io.tsx';
import { ClosedYearsView, WalletsView } from './records-misc.tsx';
import { LoansView } from './records-loans.tsx';
import { KitCard } from './records-kit.tsx';
import { buildItems, entryRows, NO_FILTER } from '../../lib/entry-list.ts';
import { useState } from 'react';
import { useTitle } from '../../ui/use-title.ts';
import { BankIcon, ChevronRightIcon, HeartIcon, ImportExportIcon, ListIcon, LockIcon, WalletIcon } from '../../ui/icons.tsx';

type View = 'entries' | 'giving' | 'closed' | 'wallets' | 'loans' | 'io';
const VIEWS: readonly View[] = ['entries', 'giving', 'closed', 'wallets', 'loans', 'io'];

function viewTitle(view: View, givingName: string): string {
  const titles: Record<View, string> = { entries: 'All entries', giving: givingName, closed: 'Closed years', wallets: 'Wallets', loans: 'Loans', io: 'Import and export' };
  return titles[view];
}

function Tile({ to, title, sub, icon, hot, active, className }: { to: string; title: string; sub: ReactNode; icon: ReactNode; hot?: boolean; active?: boolean; className?: string }) {
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
        <span className="flex min-w-0 items-start gap-2">
          <span className={cx('-my-px flex-none', active ? 'text-amber' : 'text-soft')}>{icon}</span>
          <span className="text-[13px] font-semibold leading-tight text-balance">{title}</span>
        </span>
        <ChevronRightIcon size={16} className="-mr-0.5 flex-none text-muted" />
      </span>
      <span className={cx('text-xs', hot ? 'font-semibold text-amber' : 'text-muted')}>{sub}</span>
    </Link>
  );
}

/** Records: every entry and its history, giving, closed years, wallets, import and export, settings. */
export function Records() {
  const wide = useIsWide();
  const { entries, state, today } = useLedger();
  const [params] = useSearchParams();
  const asked = params.get('v');
  const view: View | null = VIEWS.find((v) => v === asked) ?? null;
  useTitle(view === null ? 'Records' : viewTitle(view, state.settings.givingName));
  const year = yearOf(today);
  const items = useMemo(() => buildItems(entries), [entries]);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const due = useMemo(() => (state.settings.givingEnabled ? givingDue(state, state.settings, year) : null), [state, year]);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => entryRows(items, NO_FILTER, wallets), [items, wallets]);
  const open = rows.find((r) => r.item.id === openId) ?? null;
  // The same wallets the Wallets view lists as active (retirement included).
  const active = state.wallets.filter((w) => !w.frozen && !w.archived).length;
  const openLoans = state.loans.filter((l) => !l.closed).length;

  const tiles: ReactNode = (
    <section aria-label="Sections" className={cx('grid gap-2.5', wide ? (state.settings.givingEnabled ? 'grid-cols-6' : 'grid-cols-5') : 'grid-cols-2')}>
      {due !== null && <Tile to="/records?v=giving" title={state.settings.givingName} icon={<HeartIcon size={18} />} sub={<><PlainMoney cents={Math.max(0, due.owedCents)} /> still to give</>} hot={due.owedCents > 0} active={view === 'giving'} />}
      <Tile to="/records?v=closed" title="Closed years" icon={<LockIcon size={18} />} sub={state.closedYears.length === 0 ? 'Lock a year once filed' : `${Math.min(...state.closedYears)} to ${Math.max(...state.closedYears)}`} active={view === 'closed'} />
      <Tile to="/records?v=wallets" title="Wallets" icon={<WalletIcon size={18} />} sub={`${active} active`} active={view === 'wallets'} />
      <Tile to="/records?v=loans" title="Loans" icon={<BankIcon size={18} />} sub={openLoans === 0 ? (state.loans.length === 0 ? 'Track a loan' : 'None open') : `${openLoans} open`} active={view === 'loans'} />
      <Tile to="/records?v=io" title={'Import and\u00a0export'} icon={<ImportExportIcon size={18} />} sub="CSV · backup" active={view === 'io'} className={state.settings.givingEnabled ? 'col-span-2 lg:col-span-1' : ''} />
      <Tile to="/records?v=entries" title="All entries" icon={<ListIcon size={18} />} sub={entriesCount(rows.length)} active={view === 'entries'} className="hidden lg:order-first lg:flex" />
    </section>
  );

  const recent = (
    <section aria-label="Recent entries" className="flex flex-col">
      <SectionHeader title="Recent entries" right={rows.length > 0 ? <SectionLink to="/records?v=entries">All {entriesCount(rows.length)}</SectionLink> : null} />
      {rows.length === 0 ? (
        <EmptyLine className="rounded-[18px] border border-line bg-surface px-4">Nothing logged yet.</EmptyLine>
      ) : (
        <ul className="m-0 list-none rounded-[18px] border border-line bg-surface px-3.5 py-0.5">
          {rows.slice(0, 4).map((run, i, arr) => (
            <EntryRow key={run.item.id} run={run} wallets={wallets} today={today} onOpen={() => setOpenId(run.item.id)} last={i === arr.length - 1} />
          ))}
        </ul>
      )}
    </section>
  );

  let body: ReactNode = null;
  if (view === 'entries') body = <EntriesView autoFocusSearch={params.get('search') === '1'} />;
  if (view === 'giving') body = <GivingView />;
  if (view === 'closed') body = <ClosedYearsView />;
  if (view === 'wallets') body = <WalletsView />;
  if (view === 'loans') body = <LoansView />;
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
          <h1 className="m-0 min-w-0 truncate font-display text-[28px] font-semibold tracking-tight">{viewTitle(view, state.settings.givingName)}</h1>
        </div>
      )}
      {(wide || view === null) && <KitCard today={today} />}
      {(wide || view === null) && tiles}
      {view === null && recent}
      {body}
      {open && <EntrySheet run={open} state={state} today={today} onClose={() => setOpenId(null)} />}
    </div>
  );
}
