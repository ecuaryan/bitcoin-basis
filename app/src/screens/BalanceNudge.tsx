import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { balanceNudge, nudgeSnoozed, snoozeNudge } from '../lib/balance-nudge.ts';
import { shortDate } from '../lib/format.ts';
import { ChevronRightIcon } from '../ui/icons.tsx';

/** One calm reminder to check a wallet that has not been matched in a while. Not now keeps it quiet for 60 days. */
export function BalanceNudge() {
  const { state, holdings, today } = useLedger();
  const [snoozed, setSnoozed] = useState(() => nudgeSnoozed(today));
  const nudge = useMemo(() => balanceNudge(state, holdings, today), [state, holdings, today]);
  if (nudge === null || snoozed) return null;
  return (
    <section aria-label="Balance reminder" className="flex items-center gap-1 rounded-2xl border border-line bg-surface pl-3.5">
      <Link to={`/wallet/${nudge.walletId}`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 text-text no-underline hover:text-text">
        <span className="flex items-center gap-1 text-sm font-semibold">
          Check {nudge.walletName}&apos;s balance
          <ChevronRightIcon size={14} className="flex-none text-muted" />
        </span>
        <span className="text-xs text-muted">{nudge.lastChecked === null ? 'Not checked yet' : `Last checked ${shortDate(nudge.lastChecked, today)}`} · catches missed entries</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          snoozeNudge(today);
          setSnoozed(true);
        }}
        className="min-h-11 flex-none bg-transparent px-3.5 text-xs font-semibold text-muted hover:text-text"
      >
        Not now
      </button>
    </section>
  );
}
