import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInRouterContext, useLocation } from 'react-router';

export interface ToastOptions {
  /** A button in the toast, such as Undo. Gives the person longer to reach it. */
  action?: { label: string; onClick(): void };
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
}

/**
 * One short message at a time, announced politely to screen readers. It sits at the top of the screen
 * (never over a sheet's buttons or the tab bar), is gone after 2.5 seconds (5 with a button) and goes away when you move to another screen.
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
      setMessage({ id: counter.current, text, ...(options?.action ? { action: options.action } : {}) });
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
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] z-[60] flex justify-center px-4">
        {message && (
          <div key={message.id} className={`animate-toast-in flex items-center gap-3 rounded-2xl border border-line bg-surface-2 py-3 pl-4 text-sm font-medium text-text shadow-2xl ${message.action ? 'pointer-events-auto pr-2' : 'pr-4'}`}>
            <span>{message.text}</span>
            {message.action && (
              <button
                type="button"
                onClick={() => {
                  const act = message.action;
                  dismiss();
                  act?.onClick();
                }}
                className="min-h-11 rounded-xl bg-transparent px-3 text-sm font-bold text-amber hover:text-text"
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
