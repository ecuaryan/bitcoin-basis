import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { useVaultStatus } from '../../data/vault-provider.tsx';
import { Unlock } from './Unlock.tsx';

/**
 * The route guard. No vault on this device: Welcome. Vault locked: Unlock (in place, so the address
 * survives). Unlocked, or looking at the demo: the app.
 */
export function RequireVault({ children }: { children: ReactNode }) {
  const status = useVaultStatus();
  const { isDemo } = useLedger();
  if (isDemo) return <>{children}</>;
  if (status.state === 'empty') return <Navigate to="/welcome" replace />;
  if (status.state === 'locked') return <Unlock />;
  return <>{children}</>;
}
