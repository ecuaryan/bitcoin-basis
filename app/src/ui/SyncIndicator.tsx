import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { explainError, wasCancelled } from '../data/explain-error.ts';
import { useLedger } from '../data/ledger-provider.tsx';
import { describeSync, type SyncTone } from '../data/sync-view.ts';
import { useVaultOptional, useVaultStatusOptional } from '../data/vault-provider.tsx';
import { cx } from '../lib/cx.ts';
import { useToast } from './Toast.tsx';

const DOT: Record<SyncTone, string> = { ok: 'bg-accent', busy: 'animate-pulse bg-amber', quiet: 'bg-muted', attention: 'bg-loss' };

/**
 * A calm status in the header. All good: nothing on phones, a small labelled "Synced" on desktop.
 * Offline and problems are a labelled pill;
 * "Sign in to sync" is an orange-outlined button that signs in right here. Every other state opens
 * Settings, where syncing is explained. Hidden in the demo.
 */
export function SyncIndicator({ className }: { className?: string }) {
  const status = useVaultStatusOptional();
  const vault = useVaultOptional();
  const { isDemo } = useLedger();
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (status === null || isDemo || status.state !== 'unlocked') return null;
  const v = describeSync(status.sync, now);

  if (v.canConnect && vault !== null) {
    const connect = async () => {
      setBusy(true);
      try {
        await vault.connect();
      } catch (e) {
        if (!wasCancelled(e)) toast.show(explainError(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <button
        type="button"
        onClick={() => void connect()}
        disabled={busy}
        title={v.detail}
        className={cx('flex min-h-11 items-center rounded-full border border-accent bg-transparent px-3.5 text-xs font-semibold text-amber hover:bg-accent/10 disabled:opacity-60', className)}
      >
        {busy ? 'Signing in…' : v.label}
      </button>
    );
  }

  const pill = v.tone === 'quiet' || v.tone === 'attention';
  return (
    <Link
      to="/settings#security"
      aria-label={`Sync: ${v.label}. Open sync settings.`}
      title={v.detail}
      // A bare dot on a phone means nothing to people, so phones show sync only when it needs attention.
      className={cx('min-h-11 min-w-11 items-center justify-center text-xs text-muted no-underline hover:text-text', pill ? 'flex' : 'hidden lg:flex', className)}
    >
      <span className={cx('flex items-center gap-1.5', pill && 'rounded-full border border-line bg-surface px-3 py-1.5')}>
        <span aria-hidden="true" className={cx('size-2 rounded-full', DOT[v.tone])} />
        <span>{v.label}</span>
      </span>
    </Link>
  );
}
