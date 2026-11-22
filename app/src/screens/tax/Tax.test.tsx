// @vitest-environment happy-dom
// Tax season and the CPA summary: charity gifts with their deduction, the dual-basis flag in the year sold, no back arrow on the Tax tab.
import type { Entry } from '@bitcoin-basis/engine';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerProvider, useLedger } from '../../data/ledger-provider.tsx';
import { createMemoryStore } from '../../data/memory-store.ts';
import { renderApp, type Rendered } from '../../test/render.tsx';
import { ToastProvider } from '../../ui/Toast.tsx';
import { Tax } from './Tax.tsx';
import { TaxSummary } from './TaxSummary.tsx';

const TZ = 'America/Boise';
const noon = (d: string) => `${d}T19:00:00Z`;
const book: Entry[] = [
  { id: 'w', kind: 'wallet', at: '2023-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
  // Spec example 23: 0.1 BTC held over a year, cost $2,000, worth $9,000, to a church.
  { id: 'b', kind: 'buy', at: noon('2023-02-01'), tz: TZ, wallet: 'ex', sats: 10_000_000, costCents: 200_000, tier: 'documented' },
  { id: 'c', kind: 'give', at: noon('2026-03-01'), tz: TZ, wallet: 'ex', sats: 10_000_000, valueCents: 900_000, to: 'charity', recipient: 'Church', picks: [{ lotId: 'b', sats: 10_000_000 }] },
  // A gift received in 2024 worth $50, the giver's cost $9,000; sold in 2026 for $70.
  { id: 'g', kind: 'receive', at: noon('2024-03-01'), tz: TZ, wallet: 'ex', sats: 100_000, valueCents: 5_000, source: { type: 'gift', giverCostCents: 900_000, giverAcquiredAt: noon('2021-11-01') } },
  { id: 's', kind: 'sell', at: noon('2026-02-01'), tz: TZ, wallet: 'ex', sats: 100_000, proceedsCents: 7_000, spent: false, picks: [{ lotId: 'g', sats: 100_000 }] },
];

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  window.localStorage.clear();
});

function Loaded({ children }: { children: ReactNode }) {
  return useLedger().entries.length > 0 ? children : null;
}

async function mount(path: string) {
  app = await renderApp(
    <ToastProvider>
      <LedgerProvider store={createMemoryStore(book)}>
        <Loaded>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/tax" element={<Tax />} />
              <Route path="/tax/summary/:year" element={<TaxSummary />} />
            </Routes>
          </MemoryRouter>
        </Loaded>
      </LedgerProvider>
    </ToastProvider>,
  );
  await vi.waitFor(() => expect(app?.container.textContent).toMatch(/Tax season|tax year summary/));
  return app.container;
}

describe('Tax season (phone)', () => {
  // A phone-sized window: the wide layout (min-width: 1024px) does not match.
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList);
  });
  afterEach(() => vi.restoreAllMocks());
  it('has no back arrow: Tax is a bottom tab', async () => {
    const c = await mount('/tax?year=2026');
    expect(c.querySelector('[aria-label="Back to Records"]')).toBeNull();
    expect(c.querySelector('h1')?.textContent).toBe('Tax season');
  });
  it('lists the charity gift with its value, deduction and term', async () => {
    const c = await mount('/tax?year=2026');
    const list = c.querySelector('[aria-label="Charity gifts"]');
    expect(list?.textContent).toContain('Church · Mar 1, 2026');
    expect(list?.textContent).toContain('$9,000.00');
    expect(list?.textContent).toContain('Deduction $9,000.00 · long-term');
  });
  it('asks to confirm the dual basis in the year the gift coins were sold', async () => {
    const c = await mount('/tax?year=2026');
    expect(c.querySelector('[aria-label="Ask your CPA"]')?.textContent).toContain('Sale on 2026-02-01 used coins from a gift worth less than the giver');
  });
});

describe('CPA summary', () => {
  it('lists the charity gift and its deduction, and the dual-basis flag for the 2026 sale', async () => {
    const c = await mount('/tax/summary/2026');
    const text = c.textContent ?? '';
    expect(text).toContain('Charity gifts (Schedule A): deduction $9,000.00');
    const row = [...c.querySelectorAll('tr')].find((r) => r.textContent?.includes('Church'));
    expect([...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent)).toEqual(['2026-03-01', 'Church', '$9,000.00', '$9,000.00', 'long']);
    expect(text).toContain('Sale on 2026-02-01 used coins from a gift');
  });
});
