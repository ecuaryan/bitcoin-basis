// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PriceQuote, PriceService } from '../../data/price.ts';
import { PriceProvider } from '../../data/price-provider.tsx';
import { LedgerProvider } from '../../data/ledger-provider.tsx';
import { createMemoryStore } from '../../data/memory-store.ts';
import { usePriceAt, type PriceAt } from './hooks.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
let root: Root | null = null;
const seen: { price: PriceAt | null } = { price: null };

function Probe({ at, nowMs }: { at: string; nowMs: number }) {
  const p = usePriceAt(at, nowMs);
  useEffect(() => {
    seen.price = p;
  });
  return null;
}

/** The live quote is `quote`; any other time is priced at $50,000 by the history lookup. */
async function mount(quote: PriceQuote, nowMs: number) {
  const historical = vi.fn(() => Promise.resolve(5_000_000));
  const service: PriceService = { current: () => Promise.resolve(quote), historical };
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root?.render(
      <LedgerProvider store={createMemoryStore()}>
        <PriceProvider service={service}>
          <Probe at={new Date(nowMs).toISOString()} nowMs={nowMs} />
        </PriceProvider>
      </LedgerProvider>,
    );
  });
  return historical;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  seen.price = null;
  window.localStorage.clear();
});

describe('usePriceAt near now', () => {
  it('uses the live quote and names where it came from (Coinbase when mempool was down)', async () => {
    const now = Date.now();
    const historical = await mount({ usdCents: 9_500_000, prevDayUsdCents: null, fetchedAt: now, asOf: now, stale: false, provider: 'Coinbase', source: 'live' }, now);
    await vi.waitFor(() => expect(seen.price).toEqual({ cents: 9_500_000, status: 'ok', source: 'Coinbase' }));
    expect(historical).not.toHaveBeenCalled();
  });

  it('does not take a kept price from hours ago as the price now: it looks the time up instead', async () => {
    const now = Date.now();
    const historical = await mount({ usdCents: 9_100_000, prevDayUsdCents: null, fetchedAt: now, asOf: now - 2 * HOUR, stale: true, provider: 'mempool.space', source: 'live' }, now);
    await vi.waitFor(() => expect(seen.price).toEqual({ cents: 5_000_000, status: 'ok', source: 'mempool.space' }));
    expect(historical).toHaveBeenCalledTimes(1);
  });
});
