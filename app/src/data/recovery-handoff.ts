/**
 * Short-lived, in-memory hand-offs between screens. Nothing here is ever written to storage.
 *
 * - The new recovery code (after setup or rotation) is shown once; it lives here only until the
 *   person says they are done, locks the app, or reloads the page. This is NOT a Bitcoin seed phrase.
 * - A recovery code read from a `#recover=` link is held here so a redirect can't lose it.
 */
type Listener = () => void;

let pendingKit: { code: string; reason: 'setup' | 'rotate'; at: number } | null = null;
let incoming: string | null = null;
/** True when this page was opened from a `#recover=` link (the kit's QR code): browsers can keep that link in history. */
let openedFromLink = false;
const linkListeners = new Set<Listener>();
const listeners = new Set<Listener>();
const emit = () => {
  for (const l of [...listeners]) l();
};

export const kitHandoff = {
  set(code: string, reason: 'setup' | 'rotate', at = Date.now()): void {
    pendingKit = { code, reason, at };
    emit();
  },
  get: () => pendingKit,
  clear(): void {
    if (pendingKit === null) return;
    pendingKit = null;
    emit();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export const incomingRecovery = {
  set(code: string | null): void {
    incoming = code;
    if (code !== null) {
      openedFromLink = true;
      for (const l of [...linkListeners]) l();
    }
  },
  /** Read it once; it is gone afterwards. */
  take(): string | null {
    const c = incoming;
    incoming = null;
    return c;
  },
  peek: () => incoming,
};

/** One-time notice after unlock: the page was opened from the kit's QR link. */
export const recoveryLinkNotice = {
  pending: () => openedFromLink,
  dismiss(): void {
    if (!openedFromLink) return;
    openedFromLink = false;
    for (const l of [...linkListeners]) l();
  },
  subscribe(l: Listener): () => void {
    linkListeners.add(l);
    return () => void linkListeners.delete(l);
  },
};
