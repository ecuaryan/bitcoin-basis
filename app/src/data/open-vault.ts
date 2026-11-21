import type { PriceService } from './price.ts';
import { Vault } from '../vault/index.ts';

/** Opens the vault on this device. The test build (never a production build) swaps in a fake server and authenticator. */
export async function openVault(): Promise<Vault> {
  if (__BB_FAKE__) {
    const { openFakeVault } = await import('../test-support/fake-boot.ts');
    return openFakeVault();
  }
  return Vault.open();
}

/** The price service: the default (this app's Worker) everywhere except the test build, which asks its fake server. */
export async function openPriceService(): Promise<PriceService | undefined> {
  if (__BB_FAKE__) {
    const { fakePriceService } = await import('../test-support/fake-boot.ts');
    return fakePriceService();
  }
  return undefined;
}
