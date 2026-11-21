/**
 * End-to-end test build only (`vite build --mode fake`). Opens a vault wired to an in-page fake
 * server and fake authenticator, and exposes them on `window.__bbFake` for Playwright.
 * BB_FAKE_AUTHENTICATOR_MARKER: the production bundle must never contain this text.
 */
import { createMempoolPriceService, type PriceService } from '../data/price.ts';
import { incomingRecovery } from '../data/recovery-handoff.ts';
import { DEMO_PRICE_CENTS, demoPriceAt } from '../demo/demo-data.ts';
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
  // Prices for the app's own price endpoints, so testers and tests see real figures: today's is fixed, the past
  // follows the demo's made-up curve. Tests can fail them with `server.failing.set('/api/price', 503)`.
  server.priceCents = DEMO_PRICE_CENTS;
  server.priceAt = (ts) => demoPriceAt(ts * 1000);
  // Like a real platform authenticator, it refuses to create a second passkey for these records
  // (`excludeCredentials`); after `forgetDevice()` its passkey stands in for one synced from another device.
  const auth = new FakeAuthenticator('e2e', { origin: window.location.origin, rpId: host, honorExclude: true });
  // `?fake=kit-link`: records already set up on "another device" whose passkey syncs to this one (the same
  // authenticator), and this page opened as if from the kit's QR code. A real `#recover=` link can't be used here:
  // its code only exists after setup, and loading a page starts the in-memory fake over.
  if (new URLSearchParams(window.location.search).get('fake') === 'kit-link') incomingRecovery.set(await setUpElsewhere(server, auth));
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

/** Set up records from a second, throwaway device on the same fake server and authenticator; returns its recovery code. */
async function setUpElsewhere(server: FakeServer, auth: FakeAuthenticator): Promise<string> {
  const other = await Vault.open({
    db: createMemoryDb(),
    api: createApiClient({ fetch: server.client().fetch }),
    credentials: auth,
    prfSupport: () => Promise.resolve('supported'),
    origin: window.location.origin,
    environment: null,
    channel: null,
    pollIntervalMs: 0,
  });
  const { recoveryCode } = await other.create({ setupCode: FAKE_SETUP_CODE });
  other.dispose();
  return recoveryCode;
}

/** The price service of the test build: the real client code, answered by the fake server (same switches: offline, failing). */
export function fakePriceService(): PriceService {
  const fake = window.__bbFake;
  if (fake === undefined) throw new Error('Open the fake vault first.');
  return createMempoolPriceService((url, init) => fake.client.fetch(url, { ...init, credentials: 'same-origin' }));
}
