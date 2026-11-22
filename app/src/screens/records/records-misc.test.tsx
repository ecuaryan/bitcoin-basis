// @vitest-environment happy-dom
import type { Entry } from '@bitcoin-basis/engine';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerProvider } from '../../data/ledger-provider.tsx';
import { createMemoryStore } from '../../data/memory-store.ts';
import { renderApp, type Rendered } from '../../test/render.tsx';
import { ToastProvider } from '../../ui/Toast.tsx';
import { ClosedYearsView } from './records-misc.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

const close = (id: string, year: number): Entry => ({ id, kind: 'close-year', at: `${year + 1}-04-01T18:00:00Z`, tz: 'America/Boise', year });

describe('Closed years', () => {
  it('lists the newest year first', async () => {
    // Closed in this order: 2023, 2025, 2024.
    app = await renderApp(
      <MemoryRouter>
        <ToastProvider>
          <LedgerProvider store={createMemoryStore([close('c1', 2023), close('c2', 2025), close('c3', 2024)])}>
            <ClosedYearsView />
          </LedgerProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const unlockButtons = () => [...document.querySelectorAll('button')].map((b) => b.textContent ?? '').filter((t) => t.startsWith('Unlock'));
    await vi.waitFor(() => expect(unlockButtons()).toHaveLength(3));
    expect(unlockButtons()).toEqual(['Unlock 2025…', 'Unlock 2024…', 'Unlock 2023…']);
  });
});
