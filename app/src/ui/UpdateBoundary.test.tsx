// @vitest-environment happy-dom
import { lazy, Suspense } from 'react';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { click, renderApp, type Rendered } from '../test/render.tsx';
import { VaultError } from '../vault/errors.ts';
import { isChunkLoadError, StartupProblem, UPDATE_READY_TEXT, UpdateBoundary } from './UpdateBoundary.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  vi.restoreAllMocks();
});

it('a screen whose code is gone after a deploy offers "Reload to update" instead of a blank app', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const Gone = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Tax-old.js')));
  const reload = vi.fn();
  app = await renderApp(
    <UpdateBoundary reload={reload}>
      <Suspense fallback={null}>
        <Gone />
      </Suspense>
    </UpdateBoundary>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(document.body.textContent).toContain(UPDATE_READY_TEXT);
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reload to update');
  await click(button as HTMLButtonElement);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('tells chunk failures from other errors', () => {
  expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
  expect(isChunkLoadError(new Error('x is undefined'))).toBe(false);
});

it('storage held by another window says so at startup', async () => {
  app = await renderApp(<StartupProblem error={new VaultError('storage-blocked')} reload={() => undefined} />);
  expect(document.body.textContent).toContain('Close its other windows');
});
