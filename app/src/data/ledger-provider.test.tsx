// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LedgerStore } from './ledger-store.ts';
import { createMemoryStore } from './memory-store.ts';
import { LedgerProvider, useLedger, type Ledger } from './ledger-provider.tsx';
import { renderApp, type Rendered } from '../test/render.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

function realStore(): LedgerStore & { clear: ReturnType<typeof vi.fn> } {
  const inner = createMemoryStore();
  return { ...inner, clear: vi.fn(() => Promise.reject(new Error('the vault store is append-only'))) };
}

describe('store selection', () => {
  it('demo goes to the demo store; clear() is never called on the real (vault) store', async () => {
    const real = realStore();
    const demo = createMemoryStore();
    let ledger: Ledger | null = null;
    function Grab() {
      ledger = useLedger();
      return null;
    }
    app = await renderApp(
      <LedgerProvider store={real} demoStore={demo}>
        <Grab />
      </LedgerProvider>,
    );
    await act(async () => {
      await (ledger as Ledger | null)?.loadDemo();
    });
    expect((ledger as Ledger | null)?.isDemo).toBe(true);
    expect(((ledger as Ledger | null)?.entries.length ?? 0) > 0).toBe(true);
    expect((await real.list()).length).toBe(0);
    await act(async () => {
      await (ledger as Ledger | null)?.clearAll();
    });
    expect((ledger as Ledger | null)?.isDemo).toBe(false);
    expect((ledger as Ledger | null)?.entries.length).toBe(0);
    expect(real.clear).not.toHaveBeenCalled();
  });

  it('a leftover demo flag is ignored while a vault exists on this device', async () => {
    let ledger: Ledger | null = null;
    function Grab() {
      ledger = useLedger();
      return null;
    }
    app = await renderApp(
      <LedgerProvider store={createMemoryStore()} demoStore={createMemoryStore()} demoAllowed={false} initialDemo>
        <Grab />
      </LedgerProvider>,
    );
    expect((ledger as Ledger | null)?.isDemo).toBe(false);
  });
});
