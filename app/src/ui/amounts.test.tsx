// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { satsToCents, formatMoney } from '../lib/format.ts';
import { click, fire, renderApp, type Rendered } from '../test/render.tsx';
import { Amount, Money } from './Amount.tsx';
import { HideButton } from './AppShell.tsx';
import { usePrefs } from './prefs.tsx';
import { ToastProvider } from './Toast.tsx';

let app: Rendered | null = null;
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  app?.unmount();
  app = null;
});
const text = () => app?.container.textContent ?? '';

describe('Money', () => {
  it('shows cents as dollars', async () => {
    app = await renderApp(<Money cents={123_456} />);
    expect(text()).toBe('$1,234.56');
  });
  it('can drop the cents and show a sign', async () => {
    app = await renderApp(<Money cents={18_032_905} precision="dollars" signed />);
    expect(text()).toBe('+$180,329');
  });
});

describe('Amount', () => {
  it('shows BTC with 8 decimals in two groups', async () => {
    app = await renderApp(<Amount sats={742_665} />);
    expect(text()).toBe('0.0074 2665');
  });
  it('adds the unit on request', async () => {
    app = await renderApp(<Amount sats={336_672_105} showUnit />);
    expect(text()).toBe('3.3667 2105 BTC');
  });
  it('cycles BTC, sats, USD, BTC when tapped', async () => {
    app = await renderApp(<Amount sats={742_665} />);
    const btn = () => app?.container.querySelector('button') as HTMLButtonElement;
    await click(btn());
    expect(text()).toBe('742,665');
    await click(btn());
    expect(text()).toBe(formatMoney(satsToCents(742_665, 9_481_240)));
    await click(btn());
    expect(text()).toBe('0.0074 2665');
  });
  it('is plain text, not a button, when not interactive', async () => {
    app = await renderApp(<Amount sats={742_665} interactive={false} />);
    expect(app.container.querySelector('button')).toBeNull();
  });
});

describe('hide amounts', () => {
  function Both() {
    const { hidden } = usePrefs();
    return (
      <ToastProvider>
        <HideButton />
        <span data-testid="state">{hidden ? 'hidden' : 'shown'}</span>
        <Money cents={31_920_690} precision="dollars" />
        <Amount sats={336_672_105} showUnit />
      </ToastProvider>
    );
  }

  it('masks every digit but keeps the shape', async () => {
    app = await renderApp(<Both />, { hidden: true });
    expect(text()).toContain('$•••,•••');
    expect(text()).toContain('•.•••• •••• BTC');
    expect(text()).not.toMatch(/\d/);
  });

  it('is off by default for a first visit; only the user turns it on', async () => {
    app = await renderApp(<Both />, {});
    // renderApp passes hidden=false; mount without the override to see the real default
    app.unmount();
    document.body.innerHTML = '<div id="root"></div>';
    const { PrefsProvider } = await import('./prefs.tsx');
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.getElementById('root') as HTMLElement);
    function Probe() {
      return <span>{usePrefs().hidden ? 'hidden' : 'shown'}</span>;
    }
    await act(async () => root.render(<PrefsProvider><Probe /></PrefsProvider>));
    expect(document.body.textContent).toBe('shown');
    act(() => root.unmount());
  });

  it('toggles with the eye button and remembers the choice', async () => {
    app = await renderApp(<Both />, { hidden: true });
    const eye = app.container.querySelector('button[aria-label="Show amounts"]') as HTMLButtonElement;
    await click(eye);
    expect(text()).toContain('shown');
    expect(text()).toContain('$319,206');
    expect(window.localStorage.getItem('bb.hide')).toBe('0');
    await click(app.container.querySelector('button[aria-label="Hide amounts"]') as HTMLButtonElement);
    expect(window.localStorage.getItem('bb.hide')).toBe('1');
  });

  it('shows amounts only while held, then hides them again', async () => {
    app = await renderApp(<Both />, { hidden: true });
    const money = app.container.querySelector('[role="button"][aria-label^="Amount hidden"]') as HTMLElement;
    await fire(money, 'pointerdown');
    expect(text()).toContain('$319,206');
    await fire(window, 'pointerup');
    expect(text()).toContain('$•••,•••');
    expect(text()).toContain('hidden');
  });

  it('peeks from the keyboard too', async () => {
    app = await renderApp(<Both />, { hidden: true });
    const btn = app.container.querySelector('button[aria-label^="Amount hidden"]') as HTMLButtonElement;
    const { key } = await import('../test/render.tsx');
    await key(btn, ' ');
    expect(text()).toContain('3.3667 2105 BTC');
    await fire(window, 'keyup');
    expect(text()).not.toMatch(/\d\.\d/);
  });
});
