import { useMemo, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { LedgerProvider, useLedger } from './data/ledger-provider.tsx';
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
  return <PriceProvider service={service} enabled={isDemo || state.wallets.length > 0}>{children}</PriceProvider>;
}

export interface ProvidersProps {
  store: LedgerStore;
  /** Defaults to mempool.space. */
  priceService?: PriceService;
  /** Start with amounts hidden or shown; defaults to the saved choice (hidden the first time). */
  initialHidden?: boolean;
  children: ReactNode;
}

export function AppProviders({ store, priceService, initialHidden, children }: ProvidersProps) {
  const live = useMemo(() => priceService ?? createMempoolPriceService(), [priceService]);
  return (
    <BrowserRouter>
      <PrefsProvider {...(initialHidden === undefined ? {} : { initialHidden })}>
        <ToastProvider>
          <LedgerProvider store={store}>
            <PriceBridge live={live}>{children}</PriceBridge>
          </LedgerProvider>
        </ToastProvider>
      </PrefsProvider>
    </BrowserRouter>
  );
}
