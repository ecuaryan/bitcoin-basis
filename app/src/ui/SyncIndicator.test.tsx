// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerProvider } from '../data/ledger-provider.tsx';
import { createMemoryStore } from '../data/memory-store.ts';
import { VaultProvider } from '../data/vault-provider.tsx';
import { renderApp, type Rendered } from '../test/render.tsx';
import type { SyncStatus, Vault, VaultStatus } from '../vault/index.ts';
import { PHONE_WAIT_MS, SyncIndicator } from './SyncIndicator.tsx';
import { ToastProvider } from './Toast.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  vi.useRealTimers();
});

const IDLE: SyncStatus = { phase: 'idle', pending: 0, lastSyncedAt: 0, rejected: 0, conflicts: 0, missingOnServer: 0, staleEpoch: 0, error: null };

/** A vault that only reports a status, which the test changes. */
function stubVault(sync: SyncStatus) {
  const listeners = new Set<(s: VaultStatus) => void>();
  let status: VaultStatus = { state: 'unlocked', vaultId: 'v', passkeyUnlock: true, unlockedWith: 'passkey', lockReason: null, autoLockMinutes: 5, recoveryCodeChanged: false, sync };
  const vault = {
    get status() {
      return status;
    },
    subscribe(cb: (s: VaultStatus) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  const set = (next: SyncStatus) => {
    status = { ...status, sync: next };
    for (const l of listeners) l(status);
  };
  return { vault: vault as unknown as Vault, set };
}

async function mount(vault: Vault) {
  app = await renderApp(
    <MemoryRouter>
      <ToastProvider>
        <VaultProvider vault={vault}>
          <LedgerProvider store={createMemoryStore([])}>
            <SyncIndicator />
          </LedgerProvider>
        </VaultProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const link = () => document.querySelector('a[aria-label^="Sync:"]') as HTMLAnchorElement | null;
/** Shown on a phone: not hidden below the desktop breakpoint. */
const onPhone = () => link()?.classList.contains('hidden') === false;

describe('SyncIndicator on a phone', () => {
  it('stays out of the way when synced, and for a save that uploads at once', async () => {
    vi.useFakeTimers();
    const { vault, set } = stubVault(IDLE);
    await mount(vault);
    expect(link()?.getAttribute('aria-label')).toBe('Sync: Synced. Open sync settings.');
    expect(onPhone()).toBe(false);
    await act(async () => set({ ...IDLE, phase: 'syncing', pending: 1 }));
    await act(async () => vi.advanceTimersByTime(PHONE_WAIT_MS / 2));
    await act(async () => set(IDLE));
    await act(async () => vi.advanceTimersByTime(PHONE_WAIT_MS));
    expect(onPhone()).toBe(false);
  });

  it('says saved changes are not uploaded yet once they have waited a moment, like desktop does', async () => {
    vi.useFakeTimers();
    const { vault, set } = stubVault(IDLE);
    await mount(vault);
    await act(async () => set({ ...IDLE, pending: 2 }));
    expect(onPhone()).toBe(false);
    await act(async () => vi.advanceTimersByTime(PHONE_WAIT_MS));
    expect(onPhone()).toBe(true);
    expect(link()?.getAttribute('aria-label')).toBe('Sync: Waiting to sync. Open sync settings.');
    // Short words on the phone, the full label on desktop.
    const phone = link()?.querySelector('.lg\\:hidden');
    const desktop = link()?.querySelector('.hidden.lg\\:inline');
    expect([phone?.textContent, desktop?.textContent]).toEqual(['Not synced', 'Waiting to sync']);
    await act(async () => set(IDLE));
    expect(onPhone()).toBe(false);
  });
});
