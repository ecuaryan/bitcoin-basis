// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { incomingRecovery, recoveryLinkNotice } from '../data/recovery-handoff.ts';
import { click, type Rendered } from '../test/render.tsx';
import { deviceWithVault, renderWithVault } from '../test/vault-fixture.tsx';
import { LinkHistoryPrompt } from './LinkHistoryPrompt.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  recoveryLinkNotice.dismiss();
  incomingRecovery.take();
});

const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;

it('asks once, after unlock, when the page was opened from the kit QR link', async () => {
  incomingRecovery.set('SOME-CODE');
  const { device } = await deviceWithVault('unlocked');
  app = await renderWithVault(<LinkHistoryPrompt />, device);
  expect(document.body.textContent).toContain("You opened this from your kit's QR code. Browsers can keep that link in history. Make a new recovery code?");
  await click(button('Not now'));
  expect(document.body.textContent).not.toContain('QR code');
});

it('stays quiet when the page was opened normally, or while locked', async () => {
  const { device } = await deviceWithVault('unlocked');
  app = await renderWithVault(<LinkHistoryPrompt />, device);
  expect(document.body.textContent).not.toContain('QR code');
  app.unmount();
  incomingRecovery.set('SOME-CODE');
  const locked = await deviceWithVault('locked');
  app = await renderWithVault(<LinkHistoryPrompt />, locked.device);
  expect(document.body.textContent).not.toContain('QR code');
});
