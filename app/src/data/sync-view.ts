import type { SyncStatus } from '../vault/index.ts';

export type SyncTone = 'ok' | 'busy' | 'quiet' | 'attention';

export interface SyncView {
  /** Short label for the header. */
  readonly label: string;
  readonly tone: SyncTone;
  /** A plain sentence for the Security screen. */
  readonly detail: string;
  /** Show a Connect button. */
  readonly canConnect: boolean;
}

/** "3 minutes ago" style text; `now` is injectable for tests. */
export function ago(at: number | null, now: number): string {
  if (at === null) return 'not yet';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function describeSync(s: SyncStatus, now: number): SyncView {
  const pending = s.pending > 0 ? ` ${s.pending} ${s.pending === 1 ? 'change is' : 'changes are'} waiting to upload.` : '';
  switch (s.phase) {
    case 'off':
      return { label: 'Locked', tone: 'quiet', detail: 'Locked. Nothing syncs until you unlock.', canConnect: false };
    case 'syncing':
      return { label: 'Syncing', tone: 'busy', detail: 'Syncing with your server now.', canConnect: false };
    case 'offline':
      return { label: 'Offline', tone: 'quiet', detail: `Offline. Your records are safe on this device and sync when you are back.${pending}`, canConnect: false };
    case 'signed-out':
      return { label: 'Sign in to sync', tone: 'attention', detail: `Not signed in to your server, so changes are not syncing.${pending}`, canConnect: true };
    case 'error':
      return { label: 'Sync problem', tone: 'attention', detail: `The last sync did not finish. It will try again on its own.${pending}`, canConnect: false };
    case 'idle':
    default:
      if (s.pending > 0) return { label: 'Waiting to sync', tone: 'busy', detail: `Last synced ${ago(s.lastSyncedAt, now)}.${pending}`, canConnect: false };
      return { label: 'Synced', tone: 'ok', detail: s.lastSyncedAt === null ? 'Connected. Waiting for the first sync.' : `Last synced ${ago(s.lastSyncedAt, now)}.`, canConnect: false };
  }
}

/** The one-line status on Settings, Security and devices. Same words as the header pill, with the time. */
export function syncRowText(s: SyncStatus, now: number): { text: string; tone: SyncTone } {
  switch (s.phase) {
    case 'off':
      return { text: 'Locked. Nothing syncs until you unlock.', tone: 'quiet' };
    case 'syncing':
      return { text: 'Syncing…', tone: 'busy' };
    case 'offline':
      return { text: "Offline · will sync when you're back online", tone: 'quiet' };
    case 'signed-out':
      return { text: 'Not signed in, so changes are not syncing.', tone: 'attention' };
    case 'error':
      return { text: "Couldn't sync. It will try again on its own.", tone: 'attention' };
    case 'idle':
    default:
      if (s.pending > 0) return { text: `Waiting to sync · ${s.pending} ${s.pending === 1 ? 'change' : 'changes'}`, tone: 'busy' };
      return { text: s.lastSyncedAt === null ? '✓ Up to date' : `✓ Up to date · last synced ${ago(s.lastSyncedAt, now)}`, tone: 'ok' };
  }
}
