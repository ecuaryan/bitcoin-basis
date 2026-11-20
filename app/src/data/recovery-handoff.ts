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
  },
  /** Read it once; it is gone afterwards. */
  take(): string | null {
    const c = incoming;
    incoming = null;
    return c;
  },
  peek: () => incoming,
};
