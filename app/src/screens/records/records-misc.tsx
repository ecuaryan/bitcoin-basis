import { Link } from 'react-router';
import { useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { shortDate } from '../../lib/format.ts';
import { buttonClasses, Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Amount } from '../../ui/Amount.tsx';
import { UnlockYearSheet } from '../tax/Tax.tsx';
import { AddWalletButton } from '../wallet/AddWallet.tsx';
import { yearLockHistory } from '../tax/tax-logic.ts';

/** Years that were closed after filing, with their history. Unlocking needs a reason. */
export function ClosedYearsView() {
  const { state, entries, today } = useLedger();
  const [unlocking, setUnlocking] = useState<number | null>(null);
  const history = yearLockHistory(entries);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 hidden font-display text-2xl font-semibold lg:block">Closed years</h2>
      <Card className="flex flex-col gap-2 !rounded-[18px] !p-4">
        {state.closedYears.length === 0 ? (
          <p className="m-0 text-[15px] text-muted">No year is closed. Close a year in Tax season once it is filed, so its numbers cannot drift.</p>
        ) : (
          state.closedYears.map((y) => (
            <div key={y} className="flex min-h-12 items-center justify-between gap-3 border-b border-line-soft last:border-0">
              <span className="text-[15px] font-semibold">{y}</span>
              <Button onClick={() => setUnlocking(y)} aria-label={`Unlock ${y}`}>
                Unlock…
              </Button>
            </div>
          ))
        )}
        <Link to="/tax" className={buttonClasses('secondary', 'mt-1 w-fit text-text no-underline')}>
          Open Tax season
        </Link>
      </Card>
      {history.length > 0 && (
        <Card as="section" aria-label="Closing history" className="flex flex-col gap-1 !rounded-[18px] !p-4">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">History</h2>
          {history.map((h) => (
            <div key={h.id} className="flex flex-col border-t border-line-soft py-2 text-sm">
              <span className="font-semibold">
                {h.kind === 'close-year' ? `Closed ${h.year}` : `Unlocked ${h.year}`}
                <span className="font-normal text-muted"> · {shortDate(h.at.slice(0, 10), today)}</span>
              </span>
              {h.reason && <span className="text-xs text-muted">Why: {h.reason}</span>}
            </div>
          ))}
        </Card>
      )}
      {unlocking !== null && <UnlockYearSheet year={unlocking} onClose={() => setUnlocking(null)} />}
    </div>
  );
}

export function WalletsView() {
  const { state, holdings } = useLedger();
  const sats = new Map(holdings.wallets.map((w) => [w.wallet, w.sats]));
  const live = state.wallets.filter((w) => !w.frozen && !w.archived);
  const apart = state.wallets.filter((w) => w.frozen || w.archived);
  const row = (w: (typeof state.wallets)[number]) => {
    const n = sats.get(w.id) ?? 0;
    return (
      <Link key={w.id} to={`/wallet/${w.id}`} className="flex min-h-14 items-center justify-between gap-3 rounded-xl px-3 text-text no-underline hover:bg-surface-2">
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold">{w.name}</span>
          <span className="text-xs normal-nums text-muted">
            {w.type === 'self-custody' ? 'Self-custody' : w.type === 'retirement' ? 'Retirement' : 'Exchange'}
            {w.frozen ? ' · frozen' : w.archived ? ' · archived' : ''}
          </span>
        </span>
        <span className="text-sm font-semibold">{w.type === 'retirement' && n === 0 ? <span className="font-normal text-muted">View only</span> : <Amount sats={n} short interactive={false} />}</span>
      </Link>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 hidden font-display text-2xl font-semibold lg:block">Wallets</h2>
      {live.length > 0 ? (
        <Card as="section" aria-label="Wallets" className="flex flex-col !rounded-[18px] !p-2">
          {live.map(row)}
        </Card>
      ) : apart.length === 0 ? (
        <p className="m-0 text-[15px] text-muted">No wallets yet.</p>
      ) : null}
      {apart.length > 0 && (
        <Card as="section" aria-label="Frozen and archived" className="flex flex-col !rounded-[18px] !p-2">
          <h2 className="m-0 px-3 pb-1 pt-2 text-xs font-semibold text-muted">Frozen and archived</h2>
          {apart.map(row)}
        </Card>
      )}
      <AddWalletButton className="self-start" />
    </div>
  );
}
