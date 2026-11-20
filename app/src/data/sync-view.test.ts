import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../vault/index.ts';
import { ago, describeSync } from './sync-view.ts';

const base: SyncStatus = { phase: 'idle', pending: 0, lastSyncedAt: 1_000_000, rejected: 0, conflicts: 0, missingOnServer: 0, error: null };

describe('describeSync', () => {
  it('synced, syncing, offline, signed out', () => {
    expect(describeSync(base, 1_000_000 + 5 * 60_000)).toMatchObject({ label: 'Synced', tone: 'ok', canConnect: false });
    expect(describeSync({ ...base, phase: 'syncing' }, 0).label).toBe('Syncing');
    expect(describeSync({ ...base, phase: 'offline', pending: 2 }, 0)).toMatchObject({ label: 'Offline', tone: 'quiet' });
    const out = describeSync({ ...base, phase: 'signed-out' }, 0);
    expect(out).toMatchObject({ label: 'Sign in to sync', tone: 'attention', canConnect: true });
  });
  it('mentions what is waiting', () => {
    expect(describeSync({ ...base, pending: 1 }, 0).detail).toContain('1 change is waiting');
  });
});

describe('ago', () => {
  it('speaks in minutes, hours and days', () => {
    expect(ago(null, 0)).toBe('not yet');
    expect(ago(1000, 10_000)).toBe('just now');
    expect(ago(0, 5 * 60_000)).toBe('5 minutes ago');
    expect(ago(0, 3 * 3_600_000)).toBe('3 hours ago');
    expect(ago(0, 24 * 3_600_000)).toBe('yesterday');
  });
});
