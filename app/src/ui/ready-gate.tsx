import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';

/** Calm placeholder shown until the local book has loaded: never an empty state built on no data. */
export function LoadingSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" data-testid="loading-skeleton" className="flex min-h-[60dvh] flex-col gap-5 motion-reduce:[&_*]:animate-none">
      <div className="h-8 w-40 animate-pulse rounded-xl bg-surface-2" />
      <div className="h-36 animate-pulse rounded-2xl bg-surface" />
      <div className="h-16 animate-pulse rounded-2xl bg-surface" />
      <div className="h-16 animate-pulse rounded-2xl bg-surface" />
    </div>
  );
}

/** Children only once the ledger has answered (skeleton before that). */
export function ReadyGate({ children }: { children: ReactNode }) {
  const { ready } = useLedger();
  return ready ? <>{children}</> : <LoadingSkeleton />;
}

/** The route outlet, held back until the ledger is ready. */
export function ReadyOutlet() {
  return (
    <ReadyGate>
      <Outlet />
    </ReadyGate>
  );
}
