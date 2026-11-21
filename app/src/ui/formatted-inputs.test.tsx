// @vitest-environment happy-dom
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { fire, renderApp, type Rendered } from '../test/render.tsx';
import { BtcInput, MoneyInput, PercentInput } from './formatted-inputs.tsx';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

function Harness({ kind }: { kind: 'money' | 'btc' | 'percent' }) {
  const [v, setV] = useState('');
  const C = kind === 'money' ? MoneyInput : kind === 'btc' ? BtcInput : PercentInput;
  return (
    <>
      <C label="Box" value={v} onChange={setV} />
      <output>{v}</output>
    </>
  );
}

const box = () => app?.container.querySelector('input') as HTMLInputElement;
const raw = () => app?.container.querySelector('output')?.textContent;

async function typeInto(el: HTMLInputElement, text: string) {
  await act(async () => {
    el.focus();
  });
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function leave(el: HTMLInputElement) {
  await act(async () => {
    el.blur();
  });
}

describe('formatted inputs', () => {
  it('money: separators after you leave, plain number underneath', async () => {
    app = await renderApp(<Harness kind="money" />);
    await typeInto(box(), '$94,812.4');
    expect(box().value).toBe('94812.4');
    expect(raw()).toBe('94812.4');
    await leave(box());
    expect(box().value).toBe('94,812.40');
    expect(app.container.textContent).toContain('$');
  });
  it('btc: groups of four, placeholder to match', async () => {
    app = await renderApp(<Harness kind="btc" />);
    expect(box().placeholder).toBe('0.0000 0000');
    await typeInto(box(), '1');
    await leave(box());
    expect(box().value).toBe('1.0000 0000');
    expect(raw()).toBe('1');
  });
  it('percent: keeps a percent sign', async () => {
    app = await renderApp(<Harness kind="percent" />);
    await typeInto(box(), '11.5%');
    expect(raw()).toBe('11.5');
    expect(app.container.textContent).toContain('%');
    await fire(box(), 'blur');
  });
});
