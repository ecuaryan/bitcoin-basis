// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { entryScript, hasUnsavedInput, isStaleShell, onServiceWorkerMessage, safeToReload, UPDATE_TEXT, UPDATED_MESSAGE, useServiceWorkerUpdateToast } from './register-sw.ts';
import { click, renderApp, type Rendered } from './test/render.tsx';
import { deviceWithVault, renderWithVault } from './test/vault-fixture.tsx';
import { settle } from './vault/test/harness.ts';
import { ToastProvider } from './ui/Toast.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

const stale = () => Promise.resolve(true as boolean | null);
function Probe({ reload, check = stale }: { reload: () => void; check?: () => Promise<boolean | null> }) {
  useServiceWorkerUpdateToast(reload, check);
  return null;
}

it('a new service worker taking over shows a quiet "New version" toast with Reload', async () => {
  const reload = vi.fn();
  app = await renderApp(
    <ToastProvider>
      <Probe reload={reload} />
    </ToastProvider>,
  );
  await act(async () => onServiceWorkerMessage({ type: 'something-else' }));
  expect(document.body.textContent).not.toContain(UPDATE_TEXT);
  await act(async () => onServiceWorkerMessage({ type: UPDATED_MESSAGE, version: 'abc' }));
  expect(document.body.textContent).toContain(UPDATE_TEXT);
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reload');
  expect(button).toBeDefined();
  await click(button as HTMLButtonElement);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('an update that arrived before the app mounted is shown once it does', async () => {
  onServiceWorkerMessage({ type: UPDATED_MESSAGE });
  app = await renderApp(
    <ToastProvider>
      <Probe reload={() => undefined} />
    </ToastProvider>,
  );
  expect(document.body.textContent).toContain(UPDATE_TEXT);
});

it('a page that already runs the new build shows nothing', async () => {
  const reload = vi.fn();
  app = await renderApp(
    <ToastProvider>
      <Probe reload={reload} check={() => Promise.resolve(false)} />
    </ToastProvider>,
  );
  await act(async () => onServiceWorkerMessage({ type: UPDATED_MESSAGE }));
  expect(document.body.textContent).not.toContain(UPDATE_TEXT);
  expect(reload).not.toHaveBeenCalled();
});

it('an older build on the Unlock screen (vault locked, nothing typed) reloads by itself', async () => {
  const { device } = await deviceWithVault('locked');
  const reload = vi.fn();
  app = await renderWithVault(
    <ToastProvider>
      <Probe reload={reload} />
    </ToastProvider>,
    device,
  );
  await act(async () => {
    onServiceWorkerMessage({ type: UPDATED_MESSAGE });
    await settle();
  });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain(UPDATE_TEXT);
});

it('never reloads by itself while unlocked or with something typed: it asks', async () => {
  const { device } = await deviceWithVault('unlocked');
  expect(safeToReload(device.vault)).toBe(false);
  device.vault.lock();
  expect(safeToReload(device.vault)).toBe(true);
  document.body.innerHTML = '<input value="half a recovery code">';
  expect(safeToReload(device.vault)).toBe(false);
  expect(safeToReload(null)).toBe(false);
  document.body.innerHTML = '';
});

it('reads the entry script of a built index.html and compares with the server', async () => {
  const page = (src: string) => `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script><link rel="modulepreload" href="/assets/x.js"></head><body></body></html>`;
  expect(entryScript(page('/assets/index-abc.js'))).toBe('/assets/index-abc.js');
  expect(entryScript('<script src="/legacy.js"></script>')).toBeNull();
  const doc = new DOMParser().parseFromString(page('/assets/index-old.js'), 'text/html');
  const server = (src: string) => () => Promise.resolve(new Response(page(src), { status: 200 }));
  expect(await isStaleShell(server('/assets/index-new.js'), doc)).toBe(true);
  expect(await isStaleShell(server('/assets/index-old.js'), doc)).toBe(false);
  expect(await isStaleShell(() => Promise.reject(new TypeError('offline')), doc)).toBeNull();
});

it('an older build that could not reload while unlocked reloads as soon as the vault locks', async () => {
  const { device } = await deviceWithVault('unlocked');
  const reload = vi.fn();
  const check = vi.fn(stale);
  app = await renderWithVault(
    <ToastProvider>
      <Probe reload={reload} check={check} />
    </ToastProvider>,
    device,
  );
  await act(async () => {
    onServiceWorkerMessage({ type: UPDATED_MESSAGE });
    await settle();
  });
  expect(reload).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(UPDATE_TEXT);
  await act(async () => {
    device.vault.lock('idle');
    await settle();
  });
  expect(check).toHaveBeenCalledTimes(2); // checked again on lock
  expect(reload).toHaveBeenCalledTimes(1);
});

it('checks again when the page comes back to the foreground, once nothing typed is left', async () => {
  const { device } = await deviceWithVault('locked');
  const reload = vi.fn();
  app = await renderWithVault(
    <ToastProvider>
      <Probe reload={reload} />
    </ToastProvider>,
    device,
  );
  const typed = document.createElement('input');
  typed.value = 'half a recovery code';
  document.body.append(typed);
  await act(async () => {
    onServiceWorkerMessage({ type: UPDATED_MESSAGE });
    await settle();
  });
  expect(reload).not.toHaveBeenCalled();
  typed.remove();
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
  });
  expect(reload).toHaveBeenCalledTimes(1);
});

it('fields nobody can type into do not count as unsaved input', () => {
  document.body.innerHTML = [
    '<form aria-hidden="true"><input type="password" value="SECRET-CODE"></form>',
    '<input readonly value="shown, not typed">',
    '<input disabled value="disabled">',
    '<div hidden><textarea>hidden</textarea></div>',
    '<input type="reset" value="Reset">',
  ].join('');
  expect(hasUnsavedInput(document)).toBe(false);
  document.body.insertAdjacentHTML('beforeend', '<textarea>a note</textarea>');
  expect(hasUnsavedInput(document)).toBe(true);
  document.body.innerHTML = '';
});
