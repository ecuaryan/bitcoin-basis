import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { balanceNudge, nudgeSnoozed, snoozeNudge } from '../lib/balance-nudge.ts';
import { confirmedLabel } from '../lib/format.ts';
import { ChevronRightIcon } from '../ui/icons.tsx';

/** One calm reminder to confirm a wallet that has not been matched in a while (or before filing). Not now keeps it quiet for 30 days. */
export function BalanceNudge() {
  const { entries, state, holdings, today } = useLedger();
  const [snoozed, setSnoozed] = useState(() => nudgeSnoozed(today));
  const nudge = useMemo(() => balanceNudge(state, holdings, today, entries), [state, holdings, today, entries]);
  if (nudge === null || snoozed) return null;
  return (
    <section aria-label="Balance reminder" className="flex w-full items-center gap-1 rounded-2xl border border-line bg-surface pl-3.5 lg:max-w-[640px]">
      <Link to={`/wallet/${nudge.walletId}`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 text-text no-underline hover:text-text">
        <span className="flex items-center gap-1 text-sm font-semibold">
          Check {nudge.walletName}&apos;s balance
          <ChevronRightIcon size={14} className="flex-none text-muted" />
        </span>
        <span className="text-xs text-muted">{confirmedLabel(nudge.lastChecked, today)} · {nudge.why === 'tax-season' ? 'worth a check before you file' : 'catches missed entries'}</span>
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
