// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, key, renderApp, type Rendered } from '../test/render.tsx';
import { Sheet } from './Sheet.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

function Demo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Log something">
        <button id="first">First</button>
        <button id="last">Last</button>
      </Sheet>
    </>
  );
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

describe('Sheet', () => {
  it('is not in the page until opened', async () => {
    app = await renderApp(<Demo />);
    expect(dialog()).toBeNull();
  });

  it('is a labelled modal dialog and moves focus inside', async () => {
    app = await renderApp(<Demo />);
    const opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    await click(opener);
    const d = dialog() as HTMLElement;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-labelledby')).toBeTruthy();
    expect(d.textContent).toContain('Log something');
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true);
  });

  it('keeps Tab inside, wrapping both ways', async () => {
    app = await renderApp(<Demo />);
    await click(document.getElementById('opener') as HTMLElement);
    const last = document.getElementById('last') as HTMLButtonElement;
    last.focus();
    await key(last, 'Tab');
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    await key(document.activeElement as Element, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and gives focus back to the opener', async () => {
    app = await renderApp(<Demo />);
    const opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    await click(opener);
    await key(document.activeElement as Element, 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
  });

  it('closes with the close button', async () => {
    app = await renderApp(<Demo />);
    await click(document.getElementById('opener') as HTMLElement);
    await click(document.querySelector('button[aria-label="Close"]') as HTMLElement);
    expect(dialog()).toBeNull();
  });
});
