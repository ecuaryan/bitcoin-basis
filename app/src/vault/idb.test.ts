/** IndexedDB opening and transactions never hang: blocked, silent, closed-under-us and stuck cases. */
import { describe, expect, test } from 'vitest';
import { VaultError } from './errors.ts';
import { openIndexedDb } from './idb.ts';

type Handler = (() => void) | null;

/** Just enough of IDBTransaction for `get`. */
class FakeTx {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;
  aborted = false;
  constructor(private readonly db: FakeDb) {}
  objectStore() {
    return {
      get: (key: string) => {
        const r = { result: undefined as unknown };
        if (this.db.stuck) return r; // never completes
        queueMicrotask(() => {
          r.result = `value:${key}`;
          this.oncomplete?.();
        });
        return r;
      },
    };
  }
  abort() {
    this.aborted = true;
  }
}

class FakeDb {
  onversionchange: Handler = null;
  onclose: Handler = null;
  closed = false;
  stuck = false;
  readonly txs: FakeTx[] = [];
  objectStoreNames = { contains: () => true };
  transaction() {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError');
    const t = new FakeTx(this);
    this.txs.push(t);
    return t;
  }
  close() {
    this.closed = true;
  }
}

/** A factory whose `open` behaves as `mode` says. */
function factory(mode: 'ok' | 'blocked' | 'silent' | 'late') {
  const dbs: FakeDb[] = [];
  const f = {
    opens: 0,
    dbs,
    open() {
      f.opens++;
      const req = { result: null as FakeDb | null, error: null, onsuccess: null as Handler, onerror: null as Handler, onblocked: null as Handler, onupgradeneeded: null as Handler };
      const succeed = () => {
        const db = new FakeDb();
        dbs.push(db);
        req.result = db;
        req.onsuccess?.();
      };
      if (mode === 'ok') queueMicrotask(succeed);
      if (mode === 'blocked') queueMicrotask(() => req.onblocked?.());
      if (mode === 'late') setTimeout(succeed, 60);
      return req;
    },
  };
  return f;
}

const asFactory = (f: unknown) => f as IDBFactory;

describe('openIndexedDb', () => {
  test.each(['blocked', 'silent'] as const)('an open that is %s rejects with storage-blocked instead of hanging', async (mode) => {
    const err = await openIndexedDb('x', asFactory(factory(mode)), { openTimeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VaultError);
    expect(err).toMatchObject({ code: 'storage-blocked' });
  });

  test('a connection that arrives after we gave up is closed at once', async () => {
    const f = factory('late');
    await expect(openIndexedDb('x', asFactory(f), { openTimeoutMs: 20 })).rejects.toMatchObject({ code: 'storage-blocked' });
    await new Promise((r) => setTimeout(r, 80));
    expect(f.dbs).toHaveLength(1);
    expect(f.dbs[0]?.closed).toBe(true);
  });

  test('another window asking to upgrade (versionchange): we close, then reopen on the next read', async () => {
    const f = factory('ok');
    const db = await openIndexedDb('x', asFactory(f));
    expect(await db.get('vault', 'k')).toBe('value:k');
    f.dbs[0]?.onversionchange?.();
    expect(f.dbs[0]?.closed).toBe(true);
    expect(await db.get('vault', 'k')).toBe('value:k');
    expect(f.opens).toBe(2);
  });

  test('a connection the browser closed under us is reopened once', async () => {
    const f = factory('ok');
    const db = await openIndexedDb('x', asFactory(f));
    f.dbs[0]?.close(); // no event, just gone
    expect(await db.get('vault', 'k')).toBe('value:k');
    expect(f.opens).toBe(2);
  });

  test('a transaction that never finishes is aborted and reported', async () => {
    const f = factory('ok');
    const db = await openIndexedDb('x', asFactory(f), { txTimeoutMs: 20 });
    (f.dbs[0] as FakeDb).stuck = true;
    await expect(db.get('vault', 'k')).rejects.toMatchObject({ code: 'storage-blocked' });
    expect(f.dbs[0]?.txs.at(-1)?.aborted).toBe(true);
  });
});
