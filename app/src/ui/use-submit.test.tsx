// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { VaultError } from '../vault/index.ts';
import { click, renderApp, type Rendered } from '../test/render.tsx';
import { ToastProvider } from './Toast.tsx';
import { useSubmit } from './use-submit.ts';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

function Save({ fail }: { fail: unknown }) {
  const s = useSubmit(async () => {
    await Promise.resolve();
    throw fail;
  });
  return (
    <button id="save" disabled={s.busy} onClick={() => void s.run()}>
      Save
    </button>
  );
}

const toastText = () => document.querySelector('[role="status"]')?.textContent ?? '';

describe('useSubmit', () => {
  it('says why a save failed, and lets the person try again', async () => {
    app = await renderApp(
      <ToastProvider>
        <Save fail={new VaultError('locked')} />
      </ToastProvider>,
    );
    const button = document.getElementById('save') as HTMLButtonElement;
    await click(button);
    expect(toastText()).toBe('Not saved. Unlock first.');
    expect(button.disabled).toBe(false);
  });

  it('a storage error gets the plain fallback, never its internals', async () => {
    app = await renderApp(
      <ToastProvider>
        <Save fail={new DOMException('The quota has been exceeded.', 'QuotaExceededError')} />
      </ToastProvider>,
    );
    await click(document.getElementById('save') as HTMLButtonElement);
    expect(toastText()).toBe('Not saved. Something went wrong. Try again.');
  });
});
