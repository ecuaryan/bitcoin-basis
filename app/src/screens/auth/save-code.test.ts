// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_LABEL, saveToPasswordManager } from './save-code.ts';

const CODE = 'ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789';
const g = globalThis as { PasswordCredential?: unknown };

afterEach(() => {
  delete g.PasswordCredential;
  vi.restoreAllMocks();
});

function withCredentials(store: () => Promise<void>) {
  const made: unknown[] = [];
  g.PasswordCredential = function (this: unknown, data: unknown) {
    made.push(data);
  };
  Object.defineProperty(navigator, 'credentials', { value: { store }, configurable: true });
  return made;
}

describe('saveToPasswordManager', () => {
  it('uses the Credential Management API where it exists', async () => {
    const store = vi.fn(() => Promise.resolve());
    const made = withCredentials(store);
    expect(await saveToPasswordManager(CODE, null)).toBe('credential');
    expect(store).toHaveBeenCalledOnce();
    expect(made).toEqual([{ id: CODE_LABEL, name: CODE_LABEL, password: CODE }]);
  });

  it('a rejection is quiet: no throw, reports failed', async () => {
    withCredentials(() => Promise.reject(new Error('NotAllowedError')));
    expect(await saveToPasswordManager(CODE, document.createElement('form'))).toBe('failed');
  });

  it('falls back to submitting the hidden form without PasswordCredential', async () => {
    const form = document.createElement('form');
    const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => undefined);
    expect(await saveToPasswordManager(CODE, form)).toBe('form');
    expect(submit).toHaveBeenCalledOnce();
  });

  it('fails quietly with neither path', async () => {
    expect(await saveToPasswordManager(CODE, null)).toBe('failed');
    const form = document.createElement('form');
    vi.spyOn(form, 'requestSubmit').mockImplementation(() => {
      throw new Error('x');
    });
    expect(await saveToPasswordManager(CODE, form)).toBe('failed');
  });
});

describe('a prompt that stays open', () => {
  it('does not hold the caller for more than a second', async () => {
    vi.useFakeTimers();
    withCredentials(() => new Promise<void>(() => undefined));
    const result = saveToPasswordManager(CODE, null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe('credential');
    vi.useRealTimers();
  });
});
