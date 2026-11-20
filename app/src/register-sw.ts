/** Registers the service worker that keeps the app shell available offline. Production builds only. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  });
}
