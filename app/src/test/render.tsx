import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createFixedPriceService } from '../data/price.ts';
import { PriceProvider } from '../data/price-provider.tsx';
import { PrefsProvider } from '../ui/prefs.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  root: Root;
  unmount(): void;
}

/** Mount into a fresh `#root` (so Sheet can make it inert), inside the app's preference and price providers. */
export async function renderApp(ui: ReactNode, { hidden = false, priceCents = 9_481_240 }: { hidden?: boolean; priceCents?: number } = {}): Promise<Rendered> {
  document.body.innerHTML = '<div id="root"></div>';
  const container = document.getElementById('root') as HTMLElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PrefsProvider initialHidden={hidden}>
        <PriceProvider service={createFixedPriceService(priceCents)}>{ui}</PriceProvider>
      </PrefsProvider>,
    );
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      document.body.innerHTML = '';
    },
  };
}

export async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export async function fire(el: EventTarget, type: string, init: EventInit = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
  });
}

export async function key(el: Element, k: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}
