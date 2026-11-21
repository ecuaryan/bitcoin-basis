// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { onServiceWorkerMessage, UPDATE_TEXT, UPDATED_MESSAGE, useServiceWorkerUpdateToast } from './register-sw.ts';
import { click, renderApp, type Rendered } from './test/render.tsx';
import { ToastProvider } from './ui/Toast.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

function Probe({ reload }: { reload: () => void }) {
  useServiceWorkerUpdateToast(reload);
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
