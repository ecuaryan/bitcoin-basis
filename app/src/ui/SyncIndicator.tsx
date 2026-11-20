import { useEffect, useState } from 'react';
import { useLedger } from '../data/ledger-provider.tsx';
import { describeSync } from '../data/sync-view.ts';
import { useVaultStatusOptional } from '../data/vault-provider.tsx';
import { cx } from '../lib/cx.ts';

/** A small calm status in the header: synced, syncing, offline, or needs sign-in. Hidden in the demo. */
export function SyncIndicator({ className }: { className?: string }) {
  const status = useVaultStatusOptional();
  const { isDemo } = useLedger();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (status === null || isDemo || status.state !== 'unlocked') return null;
  const v = describeSync(status.sync, now);
  return (
    <span role="status" aria-label={`Sync: ${v.label}`} title={v.detail} className={cx('flex min-h-11 items-center gap-1.5 px-1 text-xs text-muted', className)}>
      <span
        aria-hidden="true"
        className={cx('size-2 rounded-full', v.tone === 'ok' && 'bg-accent', v.tone === 'busy' && 'animate-pulse bg-amber', v.tone === 'quiet' && 'bg-muted', v.tone === 'attention' && 'bg-loss')}
      />
      <span className="hidden sm:inline lg:inline">{v.label}</span>
    </span>
  );
}
