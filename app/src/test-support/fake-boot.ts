/**
 * End-to-end test build only (`vite build --mode fake`). Opens a vault wired to an in-page fake
 * server and fake authenticator, and exposes them on `window.__bbFake` for Playwright.
 * BB_FAKE_AUTHENTICATOR_MARKER: the production bundle must never contain this text.
 */
import { createApiClient } from '../vault/api.ts';
import { createMemoryDb } from '../vault/idb.ts';
import { FakeAuthenticator } from '../vault/test/fake-authenticator.ts';
import { FakeServer, type FakeClient } from '../vault/test/fake-server.ts';
import { Vault } from '../vault/vault.ts';

export const FAKE_MARKER = 'BB_FAKE_AUTHENTICATOR_MARKER';
export const FAKE_SETUP_CODE = 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234';

export interface FakeHandles {
  server: FakeServer;
  auth: FakeAuthenticator;
  client: FakeClient;
  vault: Vault;
  setupCode: string;
  marker: string;
}

declare global {
  interface Window {
    __bbFake?: FakeHandles;
  }
}

export async function openFakeVault(): Promise<Vault> {
  const host = window.location.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('The fake vault only runs on localhost.');
  const server = new FakeServer(FAKE_SETUP_CODE);
  const auth = new FakeAuthenticator('e2e', { origin: window.location.origin, rpId: host });
  const client = server.client();
  const vault = await Vault.open({
    db: createMemoryDb(),
    // Shorter than production (15 s, 8 s) so the hanging-server e2e tests run quickly.
    api: createApiClient({ fetch: client.fetch, timeoutMs: 5_000 }),
    unlockNetworkMs: 1_500,
    credentials: auth,
    prfSupport: () => Promise.resolve('supported'),
    origin: window.location.origin,
    isOnline: () => !client.offline,
    pollIntervalMs: 0,
  });
  window.__bbFake = { server, auth, client, vault, setupCode: FAKE_SETUP_CODE, marker: FAKE_MARKER };
  return vault;
}
