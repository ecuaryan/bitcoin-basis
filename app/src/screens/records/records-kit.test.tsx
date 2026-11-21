// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, renderApp, type Rendered } from '../../test/render.tsx';
import { KIT_TESTED_KEY, KitCard, kitTestDue } from './records-kit.tsx';

let app: Rendered | null = null;
beforeEach(() => window.localStorage.removeItem(KIT_TESTED_KEY));
afterEach(() => {
  app?.unmount();
  app = null;
});

const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;

describe('kitTestDue', () => {
  it('is due until tested, then again a year later', () => {
    expect(kitTestDue(null, '2026-05-01')).toBe(true);
    expect(kitTestDue('2026-05-01', '2027-04-30')).toBe(false);
    expect(kitTestDue('2026-05-01', '2027-05-01')).toBe(true);
  });
});

describe('KitCard', () => {
  it('opens the steps, explains a lost code, and hides after It worked', async () => {
    app = await renderApp(<KitCard today="2026-05-01" />);
    await click(button('Test'));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Test your emergency kit');
    expect(dialog.querySelectorAll('ol > li')).toHaveLength(3);
    expect(dialog.textContent).toContain(window.location.origin);
    await click(button("I can't find my code"));
    expect(dialog.textContent).toContain('the old code stops working');
    await click(button('It worked'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(app.container.textContent).not.toContain('Test your emergency kit');
    expect(window.localStorage.getItem(KIT_TESTED_KEY)).toBe('2026-05-01');
  });
});
