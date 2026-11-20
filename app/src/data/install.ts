/** "Install app" support: Chrome (Android and desktop) offers it through `beforeinstallprompt`. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of [...listeners]) l();
};

/** Call once at startup, before the event fires. */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

export const installPrompt = {
  available: () => deferred !== null,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  async run(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const e = deferred;
    if (e === null) return 'unavailable';
    deferred = null;
    emit();
    await e.prompt();
    return (await e.userChoice).outcome;
  },
};

/** Already running as an installed app (no point offering to install it again). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}
