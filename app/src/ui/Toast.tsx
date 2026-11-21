import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInRouterContext, useLocation } from 'react-router';
import { confirmHaptic } from './haptics.ts';

export interface ToastOptions {
  /** A button in the toast, such as Undo. Gives the person longer to reach it. */
  action?: { label: string; onClick(): void };
  /** Something the person did worked (saved, added, confirmed): a check draws in and Android phones tap once. */
  success?: boolean;
}

interface ToastApi {
  show(message: string, options?: ToastOptions): void;
  dismiss(): void;
}
const ToastContext = createContext<ToastApi | null>(null);

interface Message {
  id: number;
  text: string;
  action?: ToastOptions['action'];
  success: boolean;
}

/**
 * One short message at a time, announced politely to screen readers. On a phone it sits just below the header (never
 * over the brand and buttons, a sheet's buttons or the tab bar); on a desktop in the bottom right corner, clear of the sidebar and a centered sheet. It is gone after
 * 2.5 seconds (5 with a button) and goes away when you move to another screen.
 */
export function ToastProvider({ children, durationMs = 2500 }: { children: ReactNode; durationMs?: number }) {
  const inRouter = useInRouterContext();
  const [message, setMessage] = useState<Message | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const shownAt = useRef(0);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setMessage(null);
  }, []);
  // A message shown in the same moment as a move (saved, then go back) should survive that move.
  const dismissOnMove = useCallback(() => {
    if (Date.now() - shownAt.current > 600) dismiss();
  }, [dismiss]);
  const show = useCallback(
    (text: string, options?: ToastOptions) => {
      counter.current += 1;
      shownAt.current = Date.now();
      setMessage({ id: counter.current, text, success: options?.success === true, ...(options?.action ? { action: options.action } : {}) });
      if (options?.success === true) confirmHaptic();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), options?.action ? durationMs * 2 : durationMs);
    },
    [durationMs],
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      {inRouter ? <RouteWatcher onChange={dismissOnMove} /> : null}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed print:hidden inset-x-0 top-[calc(env(safe-area-inset-top)+72px)] z-[60] flex justify-center px-4 lg:inset-x-auto lg:bottom-[max(24px,env(safe-area-inset-bottom))] lg:right-6 lg:top-auto lg:justify-end lg:px-0"
      >
        {message && (
          <div key={message.id} className={`animate-toast-in flex items-center gap-3 rounded-2xl border border-line bg-surface-2 py-3 text-sm font-medium text-text shadow-[0_12px_32px_rgb(0_0_0/0.5)] ${message.success ? 'pl-3' : 'pl-4'} ${message.action ? 'pointer-events-auto pr-1.5' : 'pr-4'}`}>
            {message.success && <SuccessCheck />}
            <span>{message.text}</span>
            {message.action && (
              <button
                type="button"
                onClick={() => {
                  const act = message.action;
                  dismiss();
                  act?.onClick();
                }}
                className="-my-3 min-h-11 rounded-xl bg-transparent px-3 text-sm font-bold text-amber hover:text-text"
              >
                {message.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** A small orange disc whose check mark draws in (instantly under reduced motion). */
function SuccessCheck() {
  return (
    <span aria-hidden="true" className="flex size-6 flex-none animate-pop items-center justify-center rounded-full bg-accent text-bg">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} className="animate-check-draw [stroke-dasharray:1]" />
      </svg>
    </span>
  );
}

/** Clears the toast when the address changes (moving to another screen or tab). */
function RouteWatcher({ onChange }: { onChange(): void }) {
  const { pathname, search } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange();
  }, [pathname, search, onChange]);
  return null;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) throw new Error('useToast needs <ToastProvider>');
  return ctx;
}
