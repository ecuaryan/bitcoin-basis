import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastApi {
  show(message: string): void;
}
const ToastContext = createContext<ToastApi | null>(null);

/** One short message at a time, announced politely to screen readers, gone after a few seconds. */
export function ToastProvider({ children, durationMs = 3500 }: { children: ReactNode; durationMs?: number }) {
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(
    (text: string) => {
      counter.current += 1;
      setMessage({ id: counter.current, text });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex justify-center px-4 lg:bottom-8">
        {message && (
          <div key={message.id} className="animate-toast-in rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm font-medium text-text shadow-2xl">
            {message.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) throw new Error('useToast needs <ToastProvider>');
  return ctx;
}
