/** Test harness: a manual clock and "devices" (memory IndexedDB + API client + vault) sharing a fake server. */
import { createApiClient } from '../api.ts';
import type { Scheduler } from '../env.ts';
import { createMemoryDb, type MemoryDb } from '../idb.ts';
import type { CredentialsLike, PrfSupport } from '../passkey.ts';
import { Vault, type VaultEnvironment } from '../vault.ts';
import type { FakeClient, FakeServer } from './fake-server.ts';

export class ManualScheduler implements Scheduler {
  private t = 1_800_000_000_000;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }
  get pending(): number {
    return this.tasks.size;
  }
  /** Move the clock without running timers (a suspended background page). */
  skip(ms: number): void {
    this.t += ms;
  }
  /** Move the clock forward, running due timers in order. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.tasks.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      this.tasks.delete(due[0]);
      this.t = Math.max(this.t, due[1].at);
      due[1].fn();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

/** Let pending promise chains (WebCrypto, fake fetch) finish. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

export interface Device {
  readonly db: MemoryDb;
  readonly client: FakeClient;
  readonly scheduler: ManualScheduler;
  readonly vault: Vault;
}

export async function makeDevice(
  server: FakeServer,
  credentials: CredentialsLike | null,
  opts: { prfSupport?: PrfSupport; environment?: VaultEnvironment | null; autoLockMinutes?: number; db?: MemoryDb; pollIntervalMs?: number } = {},
): Promise<Device> {
  const db = opts.db ?? createMemoryDb();
  const client = server.client();
  const scheduler = new ManualScheduler();
  const vault = await Vault.open({
    db,
    api: createApiClient({ fetch: client.fetch }),
    credentials,
    prfSupport: () => Promise.resolve(opts.prfSupport ?? 'unknown'),
    origin: 'https://basis.example',
    scheduler,
    isOnline: () => !client.offline,
    environment: opts.environment ?? null,
    channel: null,
    pollIntervalMs: opts.pollIntervalMs ?? 0,
    ...(opts.autoLockMinutes === undefined ? {} : { autoLockMinutes: opts.autoLockMinutes }),
  });
  return { db, client, scheduler, vault };
}
