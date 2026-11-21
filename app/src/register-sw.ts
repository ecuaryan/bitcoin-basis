/**
 * Registers the service worker that keeps the app shell available offline. Production builds only.
 *
 * The CSP has `require-trusted-types-for 'script'`, so `serviceWorker.register` needs a
 * `TrustedScriptURL`. The only policy the app creates is `sw` (the CSP allows just that name via
 * `trusted-types sw`), and it accepts exactly `/sw.js`.
 */
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

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    let url: string;
    try {
      url = serviceWorkerUrl();
    } catch {
      return; // policy already created (hot reload) or refused: offline support is a bonus
    }
    navigator.serviceWorker.register(url, { scope: '/' }).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  };
  // main.tsx awaits the vault before calling this, so `load` may already have fired.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
