// @vitest-environment happy-dom
// Review 3 PoC: in demo mode every write (Log sheet, CSV import, "Restore from a backup file") goes to the
// demo store, which is plain JSON in localStorage (`bb.ledger.v1`) and survives reloads. Nothing in the UI
// blocks imports or new entries while the demo is on, so a person who restores their real backup "to try it"
// leaves their real records unencrypted on disk. The vault store stays empty.
import { act } from 'react';
import { afterEach, expect, it } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { createLocalStorageStore, createMemoryStore } from '../data/local-storage-store.ts';
import { LedgerProvider, useLedger, type Ledger } from '../data/ledger-provider.tsx';
import { renderApp, type Rendered } from '../test/render.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  window.localStorage.clear();
});

it('a "real" entry appended in demo mode lands as plaintext in localStorage, not in the vault', async () => {
  const vaultStore = createMemoryStore();
  const demoStore = createLocalStorageStore(window.localStorage);
  let ledger: Ledger | null = null;
  function Grab() {
    ledger = useLedger();
    return null;
  }
  // demoAllowed is true whenever no vault exists on this device (fresh install / new phone before restore).
  app = await renderApp(
    <LedgerProvider store={vaultStore} demoStore={demoStore} demoAllowed>
      <Grab />
    </LedgerProvider>,
  );
  await act(async () => {
    await (ledger as unknown as Ledger).loadDemo();
  });
  // What ImportJson / LogSheet do: ledger.append(...). Use a demo-shaped wallet entry with a marker name.
  const wallet = buildDemoBook().entries.find((e) => e.kind === 'wallet');
  expect(wallet).toBeDefined();
  const secret = { ...(wallet as object), id: 'review3-real-wallet', name: 'MY REAL COLD STORAGE' } as never;
  await act(async () => {
    await (ledger as unknown as Ledger).append([secret]);
  });
  const raw = window.localStorage.getItem('bb.ledger.v1') ?? '';
  expect(raw).toContain('MY REAL COLD STORAGE'); // plaintext at rest
  expect((await vaultStore.list()).length).toBe(0); // nothing went to the encrypted store
});
