import type { ReactNode } from 'react';
import { SyncIndicator } from './SyncIndicator.tsx';
import { HideButton, LockButton, useIsWide } from './AppShell.tsx';
import { useTitle } from './use-title.ts';

/**
 * The top of a screen. On a phone the shell already has the hide and lock buttons, so the title can be
 * screen-reader-only (as in the designs) or drawn by the screen; on desktop the screen draws its own.
 */
export function PageHeader({ title, children, visibleOnPhone = false }: { title: string; children?: ReactNode; visibleOnPhone?: boolean }) {
  const wide = useIsWide();
  useTitle(title);
  if (!wide) {
    return visibleOnPhone ? (
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
        {children}
      </div>
    ) : (
      <h1 className="sr-only">{title}</h1>
    );
  }
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="m-0 font-display text-4xl font-semibold tracking-[-0.02em]">{title}</h1>
      <div className="flex items-center gap-2.5">
        {children}
        <SyncIndicator />
        <HideButton variant="text" />
        <LockButton variant="text" />
      </div>
    </header>
  );
}
