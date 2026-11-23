// @vitest-environment happy-dom
import { type Entry } from '@bitcoin-basis/engine';
import { useMemo } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerProvider, useLedger } from '../data/ledger-provider.tsx';
import { createMemoryStore } from '../data/memory-store.ts';
import { buildItems, entryRows, NO_FILTER } from '../lib/entry-list.ts';
import { click, renderApp, type Rendered } from '../test/render.tsx';
import { ToastProvider } from '../ui/Toast.tsx';
import { EntryTable } from './entry-table.tsx';

const tz = 'America/Boise';
const at = (d: string) => `${d}T18:00:00Z`;
const book: Entry[] = [
  { id: 'w1', kind: 'wallet', at: at('2025-01-01'), tz, wallet: 'ex', name: 'Strike', type: 'exchange', defaultProof: '' },
  { id: 'w2', kind: 'wallet', at: at('2025-01-01'), tz, wallet: 'cold', name: 'Cold card', type: 'self-custody', defaultProof: '' },
  { id: 'b1', kind: 'buy', at: at('2025-12-03'), tz, wallet: 'ex', sats: 10_000_000, costCents: 900_000, tier: 'documented' },
  { id: 'm1', kind: 'move', at: at('2026-04-01'), tz, from: 'ex', to: 'cold', sats: 5_000_000, feeSats: 1_840, feeValueCents: 170, picks: [{ lotId: 'b1', sats: 5_001_840 }] },
  { id: 'g1', kind: 'give', at: at('2026-06-01'), tz, wallet: 'cold', sats: 1_000_000, valueCents: 92_000, to: 'person', recipient: 'Mom', picks: [{ lotId: 'm1:b1', sats: 1_000_000 }] },
  { id: 's1', kind: 'sell', at: at('2026-05-01'), tz, wallet: 'ex', sats: 450_000, proceedsCents: 52_000, spent: false, picks: [{ lotId: 'b1', sats: 450_000 }] },
  { id: 'd1', kind: 'delete', at: at('2026-05-02'), tz, replaces: 's1', reason: 'Duplicate' },
];

function List({ walletId = null, onOpen = () => {} }: { walletId?: string | null; onOpen?: (id: string) => void }) {
  const { entries, state } = useLedger();
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const rows = useMemo(() => entryRows(buildItems(entries), { ...NO_FILTER, wallet: walletId ?? '' }, wallets), [entries, wallets, walletId]);
  return <EntryTable runs={rows} wallets={wallets} onOpen={onOpen} walletId={walletId} label="Entries" />;
}

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

async function show(opts: { hidden?: boolean; walletId?: string | null; onOpen?: (id: string) => void } = {}) {
  app = await renderApp(
    <MemoryRouter>
      <ToastProvider>
        <LedgerProvider store={createMemoryStore(book)}>
          <List walletId={opts.walletId ?? null} onOpen={opts.onOpen ?? (() => {})} />
        </LedgerProvider>
      </ToastProvider>
    </MemoryRouter>,
    { hidden: opts.hidden ?? false },
  );
  await vi.waitFor(() => expect(document.querySelectorAll('li').length).toBeGreaterThan(0));
  return [...document.querySelectorAll('li button')] as HTMLButtonElement[];
}
const rowText = (b: Element) => (b.textContent ?? '').replace(/\s+/g, ' ');
const find = (rows: Element[], word: string) => rows.find((b) => rowText(b).includes(word)) as Element;

describe('EntryTable', () => {
  it('reads each row title first, then wallet, date with its year, signed 8-decimal BTC and what the dollars were', async () => {
    const rows = await show();
    expect(rowText(find(rows, 'Gave to Mom'))).toMatch(/^♥Gave to Mom, Cold card · Jun 1, 2026, −0\.0100 0000 BTC, \$920\.00 worth then$/);
    expect(rowText(find(rows, 'Bought'))).toContain('Strike · Dec 3, 2025, +0.1000 0000 BTC, $9,000.00 paid');
  });
  it('shows a move with both wallets, unsigned, its fee under it and no dollars', async () => {
    const t = rowText(find(await show(), 'Moved'));
    expect(t).toContain('Strike → to Cold card');
    expect(t).toContain('0.0500 0000 BTC, fee 0.0000 1840 BTC');
    expect(t).toContain('no dollars');
  });
  it('keeps a removed entry, struck through with the Removed badge and muted amounts', async () => {
    const row = find(await show(), 'Removed');
    expect(row.querySelector('.line-through')?.textContent).toBe('Sold');
    expect([...row.querySelectorAll('.font-semibold.text-muted')].some((el) => el.textContent?.includes('0.0045 0000'))).toBe(true);
  });
  it("on a wallet's page, a move out shows what left (coins and fee), with what arrived in the note", async () => {
    const rows = await show({ walletId: 'ex' });
    const t = rowText(find(rows, 'Moved'));
    expect(t).toContain('Moved to Cold card');
    expect(t).toContain('0.0500 0000 BTC arrived · fee 0.0000 1840 BTC');
    expect(t).toContain('−0.0500 1840 BTC');
    expect(t).toContain('Moved to Cold card, Strike · 0.0500');
    expect(document.querySelector('[aria-hidden="true"]')?.textContent).toBe('DateWhatBitcoinDollars'); // no Wallet column
  });
  it('hides every figure under Hide amounts, but keeps the dates', async () => {
    const rows = await show({ hidden: true });
    for (const b of rows) {
      const t = rowText(b).replace(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, 20\d\d/g, '');
      expect(t, t).not.toMatch(/\d/);
    }
    expect(rowText(find(rows, 'Gave to Mom'))).toContain('Jun 1, 2026');
  });
  it('opens the entry when a row is pressed', async () => {
    const onOpen = vi.fn();
    const rows = await show({ onOpen });
    await click(find(rows, 'Gave to Mom'));
    expect(onOpen).toHaveBeenCalledWith('g1');
  });
});
