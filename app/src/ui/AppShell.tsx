import { createContext, lazy, useEffect, Suspense, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { useVaultOptional } from '../data/vault-provider.tsx';
import { cx } from '../lib/cx.ts';
import { SyncIndicator } from './SyncIndicator.tsx';
import type { LogPreset } from '../screens/log/draft.ts';
import { EyeIcon, EyeOffIcon, HoldingsIcon, LockIcon, PlusIcon, RecordsIcon, WhatIfIcon } from './icons.tsx';
import { useMediaQuery } from './motion.ts';
import { usePrefs } from './prefs.tsx';
import { useToast } from './Toast.tsx';

// The Log sheet (all its forms) loads the first time it is opened.
const loadLogSheet = () => import('../screens/log/LogSheet.tsx');
const LogSheet = lazy(() => loadLogSheet().then((m) => ({ default: m.LogSheet })));

export const WIDE_QUERY = '(min-width: 1024px)';
/** Two layouts: phone (tabs along the bottom) and desktop (sidebar) from 1024px. */
export function useIsWide(): boolean {
  return useMediaQuery(WIDE_QUERY);
}

// ---- Log sheet -------------------------------------------------------------------------

export type { LogPreset };
const LogContext = createContext<{ open(preset?: LogPreset): void } | null>(null);
/** Open the "Log something" sheet from anywhere. */
export function useLogSheet(): { open(preset?: LogPreset): void } {
  const ctx = useContext(LogContext);
  if (ctx === null) throw new Error('useLogSheet needs <AppShell>');
  return ctx;
}

// ---- Header buttons --------------------------------------------------------------------

const ICON_BUTTON = 'flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-soft transition-colors hover:text-text';
const HOLD_MS = 350;

/** Toggles hide-amounts. Holding it down shows everything for as long as it is held. */
export function HideButton({ variant = 'icon' }: { variant?: 'icon' | 'text' }) {
  const { hidden, masked, toggleHidden, startPeek, endPeek } = usePrefs();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);

  const down = () => {
    held.current = false;
    if (!masked) return;
    timer.current = setTimeout(() => {
      held.current = true;
      startPeek();
    }, HOLD_MS);
  };
  const up = () => {
    clearTimeout(timer.current);
    if (held.current) endPeek();
  };
  const click = () => {
    if (held.current) {
      held.current = false;
      return;
    }
    toggleHidden();
  };
  const label = hidden ? 'Show amounts' : 'Hide amounts';
  const common = { type: 'button' as const, onPointerDown: down, onPointerUp: up, onPointerLeave: up, onPointerCancel: up, onClick: click };
  if (variant === 'text') {
    return (
      <button {...common} className="min-h-11 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-2">
        {label}
      </button>
    );
  }
  return (
    <button {...common} aria-label={label} className={ICON_BUTTON}>
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}

export function LockButton({ variant = 'icon' }: { variant?: 'icon' | 'text' }) {
  const toast = useToast();
  const vault = useVaultOptional();
  const { isDemo } = useLedger();
  const lock = () => {
    if (vault !== null && !isDemo) vault.lock();
    else toast.show('This is the demo, so there is nothing to lock.');
  };
  if (variant === 'text') {
    return (
      <button type="button" onClick={lock} className="min-h-11 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-text hover:bg-surface-2">
        Lock
      </button>
    );
  }
  return (
    <button type="button" onClick={lock} aria-label="Lock" className={ICON_BUTTON}>
      <LockIcon />
    </button>
  );
}

export function Brand({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <img src="/icons/icon-192.png" width={size} height={size} alt="" className="block flex-none rounded-[22%]" />
      <span className="font-display font-semibold tracking-[-0.01em]" style={{ fontSize: size >= 34 ? 18 : 17 }}>
        Bitcoin Basis
      </span>
    </span>
  );
}

/** Leaves the demo and clears its made-up records. Always at least 44px tall. */
export function ExitDemoButton({ variant = 'link', className }: { variant?: 'link' | 'primary'; className?: string }) {
  const { clearAll } = useLedger();
  return (
    <button
      type="button"
      onClick={() => void clearAll()}
      className={cx(
        variant === 'primary' ? 'min-h-11 rounded-xl bg-accent px-4 text-[15px] font-bold text-bg hover:bg-amber' : 'min-h-11 bg-transparent px-3 text-xs font-semibold text-amber underline-offset-2 hover:underline',
        className,
      )}
    >
      Exit demo
    </button>
  );
}

/** Always visible in demo mode: nothing here is real, and nothing leaves this browser. */
export function DemoBanner({ className }: { className?: string }) {
  const { isDemo } = useLedger();
  if (!isDemo) return null;
  return (
    <section aria-label="Demo mode" className={cx('flex flex-wrap items-center justify-between gap-x-2 rounded-xl border border-accent/50 bg-surface py-0.5 pl-3.5 pr-1 text-xs text-soft', className)}>
      <span className="py-2">Demo — nothing is saved to your server</span>
      <ExitDemoButton />
    </section>
  );
}

/**
 * Centers its content on the screen from 1024px up (first-run screens look lost when pinned to the top
 * of a wide window) and caps its width. On a phone it is just a column.
 */
export function DesktopCenter({ children, maxWidth = 'lg:max-w-[560px]', className }: { children: ReactNode; maxWidth?: string; className?: string }) {
  return (
    <div className={cx('flex flex-col lg:min-h-[calc(100dvh-8rem)] lg:items-center lg:justify-center', className)}>
      <div className={cx('flex w-full flex-col gap-6', maxWidth)}>{children}</div>
    </div>
  );
}

// ---- Shell -----------------------------------------------------------------------------

function PhoneTab({ to, label, icon, end }: { to: string; label: string; icon: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      className={({ isActive }) =>
        cx('flex min-h-11 min-w-16 flex-col items-center justify-center gap-1 text-[11px] no-underline', isActive ? 'font-semibold text-accent' : 'font-medium text-muted hover:text-soft')
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function PhoneShell({ onLog }: { onLog(): void }) {
  return (
    <div className="relative mx-auto flex min-h-dvh max-w-[560px] flex-col overflow-x-clip">
      <div aria-hidden="true" className="pointer-events-none absolute -top-[180px] left-1/2 h-[420px] w-[520px] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(247_147_26/0.20),rgb(247_147_26/0))]" />
      <header className="relative flex items-center justify-between px-5 pt-5">
        <Brand />
        <div className="flex items-center gap-2">
          <SyncIndicator />
          <HideButton />
          <LockButton />
        </div>
      </header>
      <DemoBanner className="mx-5 mt-3" />
      <main className="relative flex flex-1 flex-col px-5 pb-[130px] pt-6">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 mx-auto flex h-[92px] max-w-[560px] items-center justify-around bg-[linear-gradient(180deg,rgb(11_11_12/0),#0b0b0c_30%)] px-3 pb-[max(20px,env(safe-area-inset-bottom))] pt-2">
        <PhoneTab to="/" end label="Holdings" icon={<HoldingsIcon size={22} />} />
        <PhoneTab to="/what-if" label="What if" icon={<WhatIfIcon size={22} />} />
        <button type="button" onClick={onLog} aria-label="Log something" className="-mt-[18px] flex size-[60px] items-center justify-center rounded-full bg-accent text-bg shadow-fab transition-transform active:scale-95">
          <PlusIcon size={28} />
        </button>
        <PhoneTab to="/records" label="Records" icon={<RecordsIcon size={22} />} />
      </nav>
    </div>
  );
}

function SideLink({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      className={({ isActive }) =>
        cx('flex min-h-11 items-center rounded-xl px-3 text-[15px] no-underline transition-colors', isActive ? 'bg-accent/12 font-semibold text-amber' : 'font-medium text-soft hover:bg-surface')
      }
    >
      {label}
    </NavLink>
  );
}

function DesktopShell({ onLog }: { onLog(): void }) {
  return (
    <div className="relative flex min-h-dvh overflow-x-clip">
      <div aria-hidden="true" className="pointer-events-none absolute -top-[260px] left-[30%] h-[620px] w-[900px] bg-[radial-gradient(closest-side,rgb(247_147_26/0.16),rgb(247_147_26/0))]" />
      <nav aria-label="Main" className="sticky top-0 flex h-dvh w-[220px] flex-none flex-col gap-1.5 border-r border-line-soft px-[18px] py-7">
        <Brand size={34} className="px-2.5 pb-[22px]" />
        <SideLink to="/" end label="Holdings" />
        <SideLink to="/what-if" label="What if" />
        <SideLink to="/tax" label="Tax season" />
        <SideLink to="/records" label="Records" />
        <div className="flex-1" />
        <button type="button" onClick={onLog} className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-accent text-[15px] font-bold text-bg transition-colors hover:bg-amber">
          <PlusIcon size={18} />
          Log
        </button>
      </nav>
      <main className="relative min-w-0 flex-1 px-10 pb-10 pt-8">
        <DemoBanner className="mb-4" />
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

/** The frame around every signed-in screen: tabs along the bottom on a phone, a sidebar on desktop, and the Log sheet. */
export function AppShell() {
  const wide = useIsWide();
  const [logOpen, setLogOpen] = useState(false);
  const [logLoaded, setLogLoaded] = useState(false);
  // Fetch the sheet quietly once the first screen is up, so the + button feels instant.
  useEffect(() => {
    const t = setTimeout(() => void loadLogSheet(), 1500);
    return () => clearTimeout(t);
  }, []);
  const [preset, setPreset] = useState<LogPreset>({});
  const open = useCallback((p?: LogPreset) => {
    setPreset(p ?? {});
    setLogOpen(true);
    setLogLoaded(true);
  }, []);
  const openPlain = useCallback(() => open(), [open]);
  const api = useMemo(() => ({ open }), [open]);
  return (
    <LogContext.Provider value={api}>
      {wide ? <DesktopShell onLog={openPlain} /> : <PhoneShell onLog={openPlain} />}
      {logLoaded ? (
        <Suspense fallback={null}>
          <LogSheet open={logOpen} onClose={() => setLogOpen(false)} preset={preset} />
        </Suspense>
      ) : null}
    </LogContext.Provider>
  );
}
