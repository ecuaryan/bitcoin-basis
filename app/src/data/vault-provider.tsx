import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Vault, VaultStatus } from '../vault/index.ts';
import { sessionMemory } from './session-memory.ts';
import { kitHandoff } from './recovery-handoff.ts';

const VaultContext = createContext<Vault | null>(null);

/** Shares the one `Vault` for this page. The vault is the only owner of keys; screens call its public API. */
export function VaultProvider({ vault, children }: { vault: Vault; children: ReactNode }) {
  // A recovery code waiting to be printed, saved scenarios and 1099 ticks must not outlive the unlocked session.
  useEffect(() => vault.subscribe((s) => {
        if (s.state !== 'unlocked') {
          kitHandoff.clear();
          sessionMemory.clear();
        }
      }), [vault]);
  return <VaultContext.Provider value={vault}>{children}</VaultContext.Provider>;
}

export function useVault(): Vault {
  const v = useContext(VaultContext);
  if (v === null) throw new Error('useVault needs <VaultProvider>');
  return v;
}

/** The vault when there is one (component tests and the demo-only shell may have none). */
export function useVaultOptional(): Vault | null {
  return useContext(VaultContext);
}

const NO_STATUS = { subscribe: () => () => undefined, snapshot: () => null };

export function useVaultStatus(): VaultStatus {
  const vault = useVault();
  return useSyncExternalStore(
    (cb) => vault.subscribe(cb),
    () => vault.status,
  );
}

/** Like `useVaultStatus`, but `null` when there is no vault. */
export function useVaultStatusOptional(): VaultStatus | null {
  const vault = useVaultOptional();
  return useSyncExternalStore(vault === null ? NO_STATUS.subscribe : (cb) => vault.subscribe(cb), vault === null ? NO_STATUS.snapshot : () => vault.status);
}

export function usePendingKit() {
  return useSyncExternalStore(kitHandoff.subscribe, kitHandoff.get);
}
