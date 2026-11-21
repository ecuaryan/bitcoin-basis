import { givingDue, yearOf, yearSummary } from '@bitcoin-basis/engine';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
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
import { SecurityView } from './records-security.tsx';
import { SettingsView } from './records-settings.tsx';
import { useVaultStatusOptional } from '../../data/vault-provider.tsx';
import { buildItems } from './records-logic.ts';
import { useState } from 'react';

type View = 'entries' | 'giving' | 'closed' | 'wallets' | 'io' | 'settings' | 'security';
const VIEWS: readonly View[] = ['entries', 'giving', 'closed', 'wallets', 'io', 'settings', 'security'];

function Tile({ to, title, sub, hot, active, className }: { to: string; title: string; sub: string; hot?: boolean; active?: boolean; className?: string }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex min-h-[92px] flex-col justify-between rounded-2xl border bg-surface p-3 text-text no-underline hover:bg-surface-2',
        active ? 'border-accent' : 'border-line',
        className,
      )}
    >
      <span className="text-[13px] font-semibold leading-tight">{title}</span>
      <span className={cx('text-xs', hot ? 'font-semibold text-amber' : 'text-muted')}>{sub}</span>
    </Link>
  );
}

/** Records: every entry and its history, giving, closed years, wallets, import and export, settings. */
export function Records() {
  const wide = useIsWide();
  const { entries, state, holdings, today, isDemo } = useLedger();
  const [params] = useSearchParams();
  const asked = params.get('v');
  const view: View | null = VIEWS.find((v) => v === asked) ?? null;
  const year = yearOf(today);
  const items = useMemo(() => buildItems(entries), [entries]);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const answer = useMemo(() => yearSummary(state, year).digitalAssetAnswer, [state, year]);
  const due = useMemo(() => (state.settings.givingEnabled ? givingDue(state, state.settings, year) : null), [state, year]);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;
  const active = holdings.wallets.filter((w) => !w.frozen && !w.archived).length;
  const vaultStatus = useVaultStatusOptional();

  const tiles: ReactNode = (
    <section aria-label="Sections" className={cx('grid gap-2.5', wide ? 'grid-cols-7' : 'grid-cols-3')}>
      <Tile to="/tax" title="Tax season" sub={`${year} · Answer: ${answer === 'yes' ? 'Yes' : 'No'}`} hot className="lg:hidden" />
      <Tile to="/records?v=giving" title={state.settings.givingName} sub={due === null ? 'Off' : `${formatMoney(Math.max(0, due.owedCents))} due`} hot={due !== null && due.owedCents > 0} active={view === 'giving'} />
      <Tile to="/records?v=closed" title="Closed years" sub={state.closedYears.length === 0 ? 'None yet' : `${Math.min(...state.closedYears)} to ${Math.max(...state.closedYears)}`} active={view === 'closed'} />
      <Tile to="/records?v=wallets" title="Wallets" sub={`${active} active`} active={view === 'wallets'} />
      <Tile to="/records?v=io" title="Import and export" sub="CSV · backup" active={view === 'io'} />
      <Tile to="/records?v=settings" title="Settings" sub="Taxes · giving" active={view === 'settings'} />
      <Tile to="/records?v=security" title="Security" sub={isDemo || vaultStatus === null ? 'Demo' : vaultStatus.autoLockMinutes === 0 ? 'Never locks' : `Locks after ${vaultStatus.autoLockMinutes} min`} active={view === 'security'} />
      <Tile to="/records?v=entries" title="All entries" sub={`${items.length} in total`} active={view === 'entries'} className="hidden lg:order-first lg:flex" />
    </section>
  );

  const recent = (
    <section aria-label="Recent entries" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between px-0.5 pb-1.5 pt-1">
        <h2 className="m-0 text-[15px] font-semibold">Recent entries</h2>
        <Link to="/records?v=entries" className="text-[13px] font-semibold no-underline">
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
  if (view === 'settings') body = <SettingsView />;
  if (view === 'security') body = <SecurityView />;

  const searchButton = (
    <Link to="/records?v=entries&search=1" aria-label="Search entries" className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-soft hover:text-text">
      <SearchIcon />
    </Link>
  );

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
          <h1 className="m-0 font-display text-xl font-semibold">Records</h1>
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
