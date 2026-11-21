/**
 * Registers the service worker that keeps the app shell available offline. Production builds only.
 *
 * The CSP has `require-trusted-types-for 'script'`, so `serviceWorker.register` needs a
 * `TrustedScriptURL`. The only policy the app creates is `sw` (the CSP allows just that name via
 * `trusted-types sw`), and it accepts exactly `/sw.js`.
 *
 * When a new version's service worker takes over, it posts `{ type: 'bb-sw-updated' }`;
 * `useServiceWorkerUpdateToast` (mount it once inside <ToastProvider>) first checks that this page
 * really runs an older build (the server's index.html names a different entry script). If it does
 * and nothing can be lost (the vault is locked, no unlock running, nothing typed), it reloads at
 * once; otherwise it offers a quiet Reload, so an unsaved form is never thrown away.
 *
 * An installed app brought back from the background makes no navigation, so the browser would not
 * look for a new service worker: we ask it to whenever the page becomes visible again.
 */
import { useEffect } from 'react';
import { useVaultOptional } from './data/vault-provider.tsx';
import type { Vault } from './vault/index.ts';
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

/** The entry script an index.html names (`/assets/index-….js`), or null. */
export function entryScript(html: string): string | null {
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\btype=["']?module\b/i.test(tag)) continue;
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src !== undefined) return new URL(src, 'https://x.invalid').pathname;
  }
  return null;
}

/**
 * Does this page run an older build than the server's? `true`/`false`, or `null` when it can't
 * tell (offline, odd page). Compares entry scripts, so it never reloads a page that is current.
 */
export async function isStaleShell(fetchImpl: typeof fetch = (i, o) => fetch(i, o), doc: Document = document): Promise<boolean | null> {
  const mine = entryScript(doc.documentElement.outerHTML);
  if (mine === null) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetchImpl('/', { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const theirs = entryScript(await res.text());
    return theirs === null ? null : theirs !== mine;
  } catch {
    return null;
  }
}

/** Something typed on the page that a reload would lose. */
export function hasUnsavedInput(doc: Document = document): boolean {
  for (const el of doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'hidden', 'button', 'submit', 'range'].includes(el.type)) continue;
    if (el.value.trim() !== '') return true;
  }
  return false;
}

/** A reload loses nothing: the vault is locked or empty, no unlock is running, nothing is typed. */
export function safeToReload(vault: Pick<Vault, 'status' | 'unlocking'> | null, doc: Document = document): boolean {
  if (vault === null) return false;
  return vault.status.state !== 'unlocked' && !vault.unlocking && !hasUnsavedInput(doc);
}

/**
 * When a new service worker has taken over: if this page is an older build, reload it when that is
 * safe, else show "New version available — Reload" once. A page that is already current shows nothing.
 */
const checkServer = () => isStaleShell();

export function useServiceWorkerUpdateToast(reload: () => void = reloadPage, checkStale: () => Promise<boolean | null> = checkServer): void {
  const toast = useToast();
  const vault = useVaultOptional();
  useEffect(() => {
    let live = true;
    const show = () => {
      if (!updatePending) return;
      updatePending = false;
      void checkStale().then((stale) => {
        if (!live || stale === false) return;
        if (stale === true && safeToReload(vault)) reload();
        else toast.show(UPDATE_TEXT, { action: { label: 'Reload', onClick: reload } });
      });
    };
    updateListeners.add(show);
    show(); // a message that arrived before this mounted
    return () => {
      live = false;
      updateListeners.delete(show);
    };
  }, [toast, reload, checkStale, vault]);
}

/** How often a page coming back to the foreground asks for a new service worker. */
const UPDATE_CHECK_MS = 5 * 60_000;

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
    navigator.serviceWorker
      .register(url, { scope: '/' })
      .then((reg) => {
        // An installed app resumed from the background: look for a new version (at most every few minutes).
        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
          lastCheck = Date.now();
          reg.update().catch(() => undefined);
        });
      })
      .catch(() => {
        // Offline support is a bonus; the app works without it.
      });
  };
  // main.tsx awaits the vault before calling this, so `load` may already have fired.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
