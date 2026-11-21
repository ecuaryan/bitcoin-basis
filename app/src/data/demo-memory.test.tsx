// @vitest-environment happy-dom
// The demo book lives only in memory: nothing it holds is ever written to storage, and import / restore are off.
import { act } from 'react';
import { afterEach, expect, it } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { ImportExportView } from '../screens/records/records-io.tsx';
import { renderApp, type Rendered } from '../test/render.tsx';
import { LedgerProvider, useLedger, type Ledger } from './ledger-provider.tsx';
import { createMemoryStore } from './memory-store.ts';
import { purgeLegacyStorage, sessionMemory } from './session-memory.ts';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  window.localStorage.clear();
  sessionMemory.clear();
});

it('an entry added in the demo never reaches localStorage', async () => {
  const vaultStore = createMemoryStore();
  let ledger: Ledger | null = null;
  function Grab() {
    ledger = useLedger();
    return null;
  }
  app = await renderApp(
    <LedgerProvider store={vaultStore} demoStore={createMemoryStore()} demoAllowed>
      <Grab />
    </LedgerProvider>,
  );
  await act(async () => {
    await (ledger as unknown as Ledger).loadDemo();
  });
  const wallet = buildDemoBook().entries.find((e) => e.kind === 'wallet');
  await act(async () => {
    await (ledger as unknown as Ledger).append([{ ...(wallet as object), id: 'demo-extra', name: 'MY REAL COLD STORAGE' } as never]);
  });
  expect((ledger as unknown as Ledger).isDemo).toBe(true);
  expect(window.localStorage.length).toBe(0);
  expect((await vaultStore.list()).length).toBe(0);
});

it('a fresh page starts outside the demo even if an old demo flag is in storage', async () => {
  window.localStorage.setItem('bb.demo', '1');
  window.localStorage.setItem('bb.ledger.v1', '[{"name":"old"}]');
  purgeLegacyStorage();
  expect(window.localStorage.getItem('bb.demo')).toBeNull();
  expect(window.localStorage.getItem('bb.ledger.v1')).toBeNull();
  let ledger: Ledger | null = null;
  function Grab() {
    ledger = useLedger();
    return null;
  }
  app = await renderApp(
    <LedgerProvider store={createMemoryStore()} demoStore={createMemoryStore()} demoAllowed>
      <Grab />
    </LedgerProvider>,
  );
  expect((ledger as unknown as Ledger).isDemo).toBe(false);
});

it('old saved scenarios and 1099 ticks are removed on load', () => {
  window.localStorage.setItem('bb.borrow.scenarios', '[{"loan":"50000"}]');
  window.localStorage.setItem('bb.1099.checked', '["2026:w1"]');
  window.localStorage.setItem('bb.hide', '0');
  purgeLegacyStorage();
  expect(window.localStorage.getItem('bb.borrow.scenarios')).toBeNull();
  expect(window.localStorage.getItem('bb.1099.checked')).toBeNull();
  expect(window.localStorage.getItem('bb.hide')).toBe('0');
});

it('Import and Restore say "Not in the demo." while the demo is on', async () => {
  app = await renderApp(
    <LedgerProvider store={createMemoryStore()} demoStore={createMemoryStore()} initialDemo>
      <ImportExportView />
    </LedgerProvider>,
  );
  const text = app.container.textContent ?? '';
  expect(text.match(/Not in the demo\./g)?.length).toBe(2);
  expect(app.container.querySelector('input[type="file"]')).toBeNull();
});
