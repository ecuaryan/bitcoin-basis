/** Registers the service worker that keeps the app shell available offline. Production builds only. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  };
  // main.tsx awaits the vault before calling this, so `load` has often already fired.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
