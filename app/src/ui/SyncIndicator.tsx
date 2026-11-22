import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { explainError, wasCancelled } from '../data/explain-error.ts';
import { useLedger } from '../data/ledger-provider.tsx';
import { describeSync, type SyncTone } from '../data/sync-view.ts';
import { useVaultOptional, useVaultStatusOptional } from '../data/vault-provider.tsx';
import { cx } from '../lib/cx.ts';
import { useToast } from './Toast.tsx';

const DOT: Record<SyncTone, string> = { ok: 'bg-accent', busy: 'animate-pulse bg-amber', quiet: 'bg-muted', attention: 'bg-loss' };

/** True once `on` has stayed true for `ms` (so a state that passes in a moment never flashes up). */
function useLasting(on: boolean, ms: number): boolean {
  const [lasting, setLasting] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setLasting(true), ms);
    return () => {
      clearTimeout(t);
      setLasting(false);
    };
  }, [on, ms]);
  return on && lasting;
}

/** How long saved changes wait to upload before a phone says so (a normal save uploads well within this). */
export const PHONE_WAIT_MS = 1500;

/**
 * A calm status in the header. All good: nothing on phones, a small labelled "Synced" on desktop.
 * Saved changes not uploaded yet: a labelled status on desktop; on phones too, once they have waited a moment.
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
  const sync = status?.state === 'unlocked' ? status.sync : null;
  const waiting = useLasting(sync !== null && sync.pending > 0 && (sync.phase === 'idle' || sync.phase === 'syncing'), PHONE_WAIT_MS);
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
  // Saved changes not uploaded yet: on a phone, the same pill as Offline, in fewer words so the header stays uncrowded.
  const phoneBusy = v.tone === 'busy' && waiting;
  const onPhone = pill || phoneBusy;
  const phoneLabel = phoneBusy && status.sync.phase === 'idle' ? 'Not synced' : v.label;
  return (
    <Link
      to="/settings#security"
      aria-label={`Sync: ${v.label}. Open sync settings.`}
      title={v.detail}
      // A bare dot on a phone means nothing to people, so phones show sync only when it needs attention
      // or saved changes are still waiting to upload.
      className={cx('min-h-11 min-w-11 items-center justify-center text-xs text-muted no-underline hover:text-text', onPhone ? 'flex' : 'hidden lg:flex', className)}
    >
      <span className={cx('flex items-center gap-1.5', pill && 'rounded-full border border-line bg-surface px-3 py-1.5', phoneBusy && 'whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 lg:border-0 lg:bg-transparent lg:p-0')}>
        <span aria-hidden="true" className={cx('size-2 rounded-full', DOT[v.tone])} />
        {phoneLabel === v.label ? (
          <span>{v.label}</span>
        ) : (
          <>
            <span className="lg:hidden">{phoneLabel}</span>
            <span className="hidden lg:inline">{v.label}</span>
          </>
        )}
      </span>
    </Link>
  );
}
