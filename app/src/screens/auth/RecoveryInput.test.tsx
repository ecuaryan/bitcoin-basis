// @vitest-environment happy-dom
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { recoveryCodeFromSecret } from '../../vault/recovery-code.ts';
import { renderApp, type Rendered } from '../../test/render.tsx';
import { RecoveryInput } from './RecoveryInput.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

let valid = false;
function Harness({ start }: { start: string }) {
  const [v, setV] = useState(start);
  return <RecoveryInput value={v} onChange={setV} onValid={(x) => (valid = x)} />;
}
const status = () => app?.container.querySelector('[role="status"]')?.textContent ?? '';

async function mount(start: string) {
  app = await renderApp(<Harness start={start} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('RecoveryInput states', () => {
  it('exposes a username and current-password pair for password managers', async () => {
    await mount('');
    expect(app?.container.querySelector('input[autocomplete="username"]')?.getAttribute('value')).toBe('Bitcoin Basis recovery code');
    expect(app?.container.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
  });
  it('an autofilled code with dashes is accepted', async () => {
    await mount((await recoveryCodeFromSecret(new Uint8Array(16).fill(7))).text);
    expect(valid).toBe(true);
  });
  it('empty shows nothing', async () => {
    await mount('');
    expect(status()).toBe('');
    expect(valid).toBe(false);
  });
  it('typing counts characters', async () => {
    await mount('7F3QX-9WM');
    expect(status()).toBe('8 of 30 characters');
  });
  it('a wrong character is named', async () => {
    await mount('7F3U');
    expect(status()).toContain('"U" is not used');
    expect(app?.container.querySelector('input[name="password"]')?.getAttribute('aria-invalid')).toBe('true');
  });
  it('a complete code with a typo is flagged, a good one is accepted', async () => {
    const good = (await recoveryCodeFromSecret(new Uint8Array(16).fill(9))).text;
    await mount(good);
    expect(status()).toBe('This code looks right.');
    expect(valid).toBe(true);
    app?.unmount();
    const flat = good.replaceAll('-', '');
    await mount(flat.slice(0, 29) + (flat.endsWith('2') ? '3' : '2'));
    expect(status()).toContain('typo');
    expect(valid).toBe(false);
  });
  it('accepts a pasted recovery link', async () => {
    const good = (await recoveryCodeFromSecret(new Uint8Array(16).fill(4))).text;
    await mount(`https://basis.example/#recover=${good}`);
    expect(valid).toBe(true);
  });
});
