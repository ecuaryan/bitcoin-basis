// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp, type Rendered } from '../test/render.tsx';
import { worthNow } from '../lib/worth-now.ts';
import { WorthLine } from './WorthLine.tsx';

let app: Rendered | null = null;
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  app?.unmount();
  app = null;
});
const text = () => app?.container.textContent ?? '';

describe('WorthLine', () => {
  it('says up with the percent', async () => {
    app = await renderApp(<WorthLine worth={worthNow(1_000_000, 72_000, 10_000_000)} />);
    expect(text()).toBe('Now $1,000.00 · up $280.00 (+38%)');
  });
  it('says down with a real minus', async () => {
    app = await renderApp(<WorthLine worth={worthNow(1_000_000, 104_000, 10_000_000)} />);
    expect(text()).toBe('Now $1,000.00 · down $40.00 (−3%)');
  });
  it('shows a dash, never a zero, with no price', async () => {
    app = await renderApp(<WorthLine worth={worthNow(1_000_000, 104_000, null)} />);
    expect(text()).toBe('Now —');
  });
  it('masks the dollars and the percent but keeps the word', async () => {
    app = await renderApp(<WorthLine worth={worthNow(1_000_000, 72_000, 10_000_000)} />, { hidden: true });
    expect(text()).not.toMatch(/\d{2,}\.\d\d/);
    expect(text()).toContain('up');
    expect(text()).not.toContain('%');
  });
});
