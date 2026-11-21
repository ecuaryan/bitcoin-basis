import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { LedgerProvider } from '../data/ledger-provider.tsx';
import { createMemoryStore } from '../data/memory-store.ts';
import { VaultProvider } from '../data/vault-provider.tsx';
import { FakeAuthenticator } from '../vault/test/fake-authenticator.ts';
import { FakeServer } from '../vault/test/fake-server.ts';
import { makeDevice, settle, type Device } from '../vault/test/harness.ts';
import { renderApp, type Rendered } from './render.tsx';

export const SETUP_CODE = 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234';

/** A device with a vault set up on a fake server. `state`: leave it unlocked, or locked. */
export async function deviceWithVault(state: 'unlocked' | 'locked'): Promise<{ device: Device; server: FakeServer; code: string }> {
  const server = new FakeServer(SETUP_CODE);
  const device = await makeDevice(server, new FakeAuthenticator('test'));
  const { recoveryCode } = await device.vault.create({ setupCode: SETUP_CODE });
  await settle();
  if (state === 'locked') device.vault.lock();
  return { device, server, code: recoveryCode };
}

/** A second device restored with the recovery code, then locked: it has no passkey. */
export async function restoredLockedDevice(server: FakeServer, code: string): Promise<Device> {
  const device = await makeDevice(server, new FakeAuthenticator('other'));
  await device.vault.unlockWithRecoveryCode(code);
  await settle();
  device.vault.lock();
  return device;
}

export function renderWithVault(ui: ReactNode, device: Device, { route = '/', demo = false }: { route?: string; demo?: boolean } = {}): Promise<Rendered> {
  return renderApp(
    <MemoryRouter initialEntries={[route]}>
      <VaultProvider vault={device.vault}>
        <LedgerProvider store={device.vault.store} demoStore={createMemoryStore()} demoAllowed={device.vault.status.state === 'empty'} initialDemo={demo}>
          {ui}
        </LedgerProvider>
      </VaultProvider>
    </MemoryRouter>,
  );
}
