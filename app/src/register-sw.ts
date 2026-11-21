/**
 * Registers the service worker that keeps the app shell available offline. Production builds only.
 *
 * The CSP has `require-trusted-types-for 'script'`, so `serviceWorker.register` needs a
 * `TrustedScriptURL`. The only policy the app creates is `sw` (the CSP allows just that name via
 * `trusted-types sw`), and it accepts exactly `/sw.js`.
 *
 * When a new version's service worker takes over, it posts `{ type: 'bb-sw-updated' }`;
 * `useServiceWorkerUpdateToast` (mount it once inside <ToastProvider>) then offers a quiet Reload.
 */
import { useEffect } from 'react';
import { useToast } from './ui/Toast.tsx';

export const SW_URL = '/sw.js';
export const SW_POLICY = 'sw';

interface TrustedTypesLike {
  createPolicy(name: string, rules: { createScriptURL: (input: string) => string }): { createScriptURL(input: string): unknown };
}

/** The script URL to register: a TrustedScriptURL where Trusted Types exist, else the plain string. */
export function serviceWorkerUrl(tt: TrustedTypesLike | undefined = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes): string {
  if (tt === undefined) return SW_URL;
  const policy = tt.createPolicy(SW_POLICY, {
    createScriptURL: (input) => {
      if (input !== SW_URL) throw new TypeError(`the ${SW_POLICY} policy only allows ${SW_URL}`);
      return input;
    },
  });
  // A TrustedScriptURL; the DOM typings here predate Trusted Types, so it is passed as a string.
  return policy.createScriptURL(SW_URL) as string;
}

export const UPDATED_MESSAGE = 'bb-sw-updated';
export const UPDATE_TEXT = 'New version available';

let updatePending = false;
const reloadPage = () => window.location.reload();
const updateListeners = new Set<() => void>();

/** Handles a message from the service worker. Exported for tests. */
export function onServiceWorkerMessage(data: unknown): void {
  if (typeof data !== 'object' || data === null || (data as { type?: unknown }).type !== UPDATED_MESSAGE) return;
  updatePending = true;
  for (const listener of updateListeners) listener();
}

/** Shows "New version available — Reload" once, when a new service worker has taken over this page. */
export function useServiceWorkerUpdateToast(reload: () => void = reloadPage): void {
  const toast = useToast();
  useEffect(() => {
    const show = () => {
      if (!updatePending) return;
      updatePending = false;
      toast.show(UPDATE_TEXT, { action: { label: 'Reload', onClick: reload } });
    };
    updateListeners.add(show);
    show(); // a message that arrived before this mounted
    return () => void updateListeners.delete(show);
  }, [toast, reload]);
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    let url: string;
    try {
      url = serviceWorkerUrl();
    } catch {
      return; // policy already created (hot reload) or refused: offline support is a bonus
    }
    navigator.serviceWorker.addEventListener('message', (e) => onServiceWorkerMessage(e.data));
    navigator.serviceWorker.register(url, { scope: '/' }).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  };
  // main.tsx awaits the vault before calling this, so `load` may already have fired.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
