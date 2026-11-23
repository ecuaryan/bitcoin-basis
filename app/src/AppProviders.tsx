import { useMemo, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { LedgerProvider, useLedger } from './data/ledger-provider.tsx';
import { useVaultStatus, VaultProvider } from './data/vault-provider.tsx';
import type { Vault } from './vault/index.ts';
import type { LedgerStore } from './data/ledger-store.ts';
import { createFixedPriceService, createMempoolPriceService, type PriceService } from './data/price.ts';
import { PriceProvider } from './data/price-provider.tsx';
import { DEMO_PREV_DAY_CENTS, DEMO_PRICE_CENTS, demoPriceAt } from './demo/demo-data.ts';
import { PrefsProvider } from './ui/prefs.tsx';
import { ToastProvider } from './ui/Toast.tsx';

/** Picks the price source: the demo book gets a fixed demo price, a real book gets mempool.space. */
function PriceBridge({ live, children }: { live: PriceService; children: ReactNode }) {
  const { isDemo, state } = useLedger();
  const service = useMemo(() => (isDemo ? createFixedPriceService(DEMO_PRICE_CENTS, DEMO_PREV_DAY_CENTS, (ts) => demoPriceAt(ts * 1000)) : live), [isDemo, live]);
  // No book yet means nothing to value, so a first visit makes no outside request.
  // Keyed by book, so a price typed for one (the demo or your own) never carries over to the other.
  return (
    <PriceProvider key={isDemo ? 'demo' : 'own'} service={service} enabled={isDemo || state.wallets.length > 0}>
      {children}
    </PriceProvider>
  );
}

export interface ProvidersProps {
  /** The encrypted vault: its store holds the real book. */
  vault: Vault;
  /** Where the made-up demo book lives (never the vault: that store is append-only). */
  demoStore: LedgerStore;
  /** Defaults to mempool.space. */
  priceService?: PriceService;
  /** Start with amounts hidden or shown; defaults to the saved choice (hidden the first time). */
  initialHidden?: boolean;
  children: ReactNode;
}

/**
 * Real data comes from the vault's store. The demo book is allowed only while the records are not open: before
 * anyone has set up, or while locked (to show someone the demo on your own phone). Unlocked, the real book wins.
 */
function LedgerBridge({ vault, demoStore, children }: { vault: Vault; demoStore: LedgerStore; children: ReactNode }) {
  const status = useVaultStatus();
  return (
    <LedgerProvider store={vault.store} demoStore={demoStore} demoAllowed={status.state !== 'unlocked'}>
      {children}
    </LedgerProvider>
  );
}

export function AppProviders({ vault, demoStore, priceService, initialHidden, children }: ProvidersProps) {
  const live = useMemo(() => priceService ?? createMempoolPriceService(), [priceService]);
  return (
    <BrowserRouter>
      <PrefsProvider {...(initialHidden === undefined ? {} : { initialHidden })}>
        <ToastProvider>
          <VaultProvider vault={vault}>
            <LedgerBridge vault={vault} demoStore={demoStore}>
              <PriceBridge live={live}>{children}</PriceBridge>
            </LedgerBridge>
          </VaultProvider>
        </ToastProvider>
      </PrefsProvider>
    </BrowserRouter>
  );
}
