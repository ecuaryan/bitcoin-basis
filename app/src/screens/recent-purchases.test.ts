import { describe, expect, it } from 'vitest';
import type { Entry } from '@bitcoin-basis/engine';
import { buildItems } from '../lib/entry-list.ts';
import { recentPurchases } from './recent-purchases.ts';

const tz = 'UTC';
const buy = (id: string, at: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'buy', at, tz, wallet: 'w1', sats: 1000, costCents: 500, tier: 'documented', ...extra }) as unknown as Entry;
const lot = (id: string, acquiredAt: string, costCents: number) => ({ id, kind: 'opening-lot', at: '2026-11-01T00:00:00Z', tz, wallet: 'w1', acquiredAt, sats: 2000, costCents, tier: 'reconstructed', origin: 'x' }) as unknown as Entry;
const ira = (id: string, at: string) => ({ id, kind: 'retirement-buy', at, tz, wallet: 'w2', sats: 3000, costCents: 900 }) as unknown as Entry;

describe('recentPurchases', () => {
  it('lists buys, retirement purchases and imported lots, newest first by when they were bought', () => {
    const rows = recentPurchases(buildItems([buy('b1', '2026-10-01T10:00:00Z'), lot('l1', '2026-10-15T10:00:00Z', 700), ira('r1', '2026-09-01T10:00:00Z'), buy('b2', '2026-11-20T10:00:00Z')]));
    expect(rows.map((r) => r.run.item.id)).toEqual(['b2', 'l1', 'b1', 'r1']);
    // An imported lot is dated when it was bought, not when it was imported.
    expect(rows[1]).toMatchObject({ date: '2026-10-15', tier: 'reconstructed', retirement: false });
    expect(rows[3]).toMatchObject({ wallet: 'w2', tier: null, retirement: true, costCents: 900 });
  });

  it('leaves out imported lots that cost nothing, removed entries and other kinds', () => {
    const entries = [lot('free', '2026-10-15T10:00:00Z', 0), buy('gone', '2026-10-01T10:00:00Z'), { id: 'del', kind: 'delete', at: '2026-10-02T00:00:00Z', tz, replaces: 'gone', reason: 'Mistake' } as unknown as Entry, { id: 'm1', kind: 'move', at: '2026-10-03T00:00:00Z', tz, from: 'w1', to: 'w2', sats: 10, feeSats: 0 } as unknown as Entry];
    expect(recentPurchases(buildItems(entries))).toEqual([]);
  });

  it('shows the latest version of an edited purchase', () => {
    const rows = recentPurchases(buildItems([buy('b1', '2026-10-01T10:00:00Z'), buy('b1v2', '2026-10-01T10:00:00Z', { replaces: 'b1', costCents: 650 })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costCents).toBe(650);
  });
});
