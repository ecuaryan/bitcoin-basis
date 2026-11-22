// @vitest-environment happy-dom
// The gift note says when coins given were inherited (always long-term), not "Bought" on the day received.
import { replay, type Entry } from '@bitcoin-basis/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, type Rendered } from '../../test/render.tsx';
import { GiftNoteCard, giftNoteText } from './GiftNote.tsx';

const TZ = 'America/Boise';
const noon = (d: string) => `${d}T19:00:00Z`;
const book: Entry[] = [
  { id: 'w', kind: 'wallet', at: '2025-01-01T00:00:00Z', tz: TZ, wallet: 'cold', name: 'Cold', type: 'self-custody', defaultProof: '' },
  { id: 'I', kind: 'receive', at: noon('2026-03-01'), tz: TZ, wallet: 'cold', sats: 1_000_000, valueCents: 90_000, source: { type: 'inherited' } },
  { id: 'B', kind: 'buy', at: noon('2026-04-01'), tz: TZ, wallet: 'cold', sats: 1_000_000, costCents: 80_000, tier: 'documented' },
  { id: 'G', kind: 'give', at: noon('2026-05-01'), tz: TZ, wallet: 'cold', sats: 2_000_000, valueCents: 200_000, to: 'person', recipient: 'Sam', picks: [{ lotId: 'I', sats: 1_000_000 }, { lotId: 'B', sats: 1_000_000 }] },
];
const gift = replay(book).gifts[0];

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

describe('gift note for inherited coins', () => {
  it('the text says inherited and always long-term; bought coins still say bought', () => {
    expect(gift).toBeDefined();
    if (gift === undefined) return;
    const text = giftNoteText(gift);
    expect(text).toContain('- Inherited Mar 1, 2026 (always long-term): 0.01000000 BTC, cost $900.00');
    expect(text).toContain('- Bought Apr 1, 2026: 0.01000000 BTC, cost $800.00');
    expect(text).not.toContain('Bought Mar 1, 2026');
  });
  it('the card says the same', async () => {
    if (gift === undefined) return;
    app = await renderApp(<GiftNoteCard gift={gift} />);
    const lots = app.container.querySelector('[aria-label="Lots given"]');
    expect(lots?.textContent).toContain('Inherited Mar 1, 2026 (always long-term)');
    expect(lots?.textContent).toContain('Bought Apr 1, 2026');
  });
});
