import type { R2Bucket } from '@cloudflare/workers-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimVault, fakeBlob, startServer } from './harness.ts';

const server = startServer();
beforeAll(() => server.listen(), 60_000);
afterAll(() => server.close());

type Buckets = { DATA: R2Bucket; BACKUP: R2Bucket };
const keys = async (b: R2Bucket) => (await b.list({ limit: 1000 })).objects.map((o) => o.key).sort();
const text = async (b: R2Bucket, key: string) => (await b.get(key))?.text();

const vaultIdOf = async (b: R2Bucket) => (JSON.parse((await text(b, 'meta/claimed')) ?? '{}') as { vaultId: string }).vaultId;

describe('daily backup cron', () => {
  it('copies objects missing from BACKUP, skips challenge markers, and never overwrites', async () => {
    const { client } = await claimVault(server); // writes meta/claimed, recovery/000001, cred/<id>, used/<challenge>
    const ups: string[] = [];
    for (let i = 0; i < 3; i++) ups.push((await client.post('/api/blobs', fakeBlob())).data.key as string);
    const first = ups[0] ?? '';
    const worker = server.getWorker<Buckets>();
    const env = await worker.getEnv();
    const P = `vault/${await vaultIdOf(env.DATA)}/`;

    // An object already in BACKUP under the same key must survive untouched.
    await env.BACKUP.put(P + first, 'pre-existing backup bytes');

    await worker.scheduled({ cron: '17 3 * * *' });
    const wanted = (await keys(env.DATA)).filter((k) => !k.startsWith('used/') && !k.startsWith('backup-progress/'));
    expect(wanted.some((k) => k.startsWith('cred/'))).toBe(true);
    expect(wanted).toContain('meta/claimed');
    expect(wanted).toContain('recovery/000001');
    expect(wanted.some((k) => k.startsWith('epoch/000001/cred/'))).toBe(true);
    expect(await keys(env.BACKUP)).toEqual(wanted.map((k) => P + k));
    expect(await text(env.BACKUP, P + first)).toBe('pre-existing backup bytes');
    for (const k of wanted.slice(1).filter((k) => k !== ups[0])) expect(await text(env.BACKUP, P + k)).toBe(await text(env.DATA, k));

    // A second run copies only what's new.
    const etags = Object.fromEntries((await env.BACKUP.list()).objects.map((o) => [o.key, o.etag]));
    const late = (await client.post('/api/blobs', fakeBlob())).data.key as string;
    await worker.scheduled({ cron: '17 3 * * *' });
    const after = (await env.BACKUP.list()).objects;
    expect(after.map((o) => o.key).sort()).toEqual([...wanted, late].map((k) => P + k).sort());
    for (const o of after) if (o.key !== P + late) expect(o.etag).toBe(etags[o.key]);

    // Each run leaves an append-only progress marker (newest lists first) with the last e/ key reached.
    const markers = (await env.DATA.list({ prefix: `backup-progress/${P.slice(6)}` })).objects.map((o) => o.key);
    expect(markers).toHaveLength(2);
    expect(JSON.parse((await text(env.DATA, markers[0] as string)) ?? '{}')).toEqual({ last: late });

    // The next run lists e/ only from ten minutes before the marker, not from the start: an object
    // planted far behind it is not seen (a real upload is never stamped that far back).
    await env.DATA.put('e/0000000000001-0000000000000000', 'old');
    const lateMs = Number(late.slice(2, 15));
    const nearKey = `e/${String(lateMs - 60_000).padStart(13, '0')}-0000000000000000`;
    await env.DATA.put(nearKey, 'slow upload');
    await worker.scheduled({ cron: '17 3 * * *' });
    const backedUp = (await keys(env.BACKUP));
    expect(backedUp).toContain(P + nearKey);
    expect(backedUp).not.toContain(`${P}e/0000000000001-0000000000000000`);
    expect(backedUp.some((k) => !k.startsWith(P) || /^vault\/[^/]+\/(used|revoked|backup-progress)\//.test(k))).toBe(false);
  });

  it('skips the run while unclaimed', async () => {
    const worker = server.getWorker<Buckets>();
    const env = await worker.getEnv();
    const before = await keys(env.BACKUP);
    for (const k of await keys(env.DATA)) await env.DATA.delete(k);
    await worker.scheduled({ cron: '17 3 * * *' });
    expect(await keys(env.BACKUP)).toEqual(before);
  });

  it('reset and reclaim: the new vault lands under its own prefix, the old one is untouched', async () => {
    const worker = server.getWorker<Buckets>();
    const env = await worker.getEnv();
    for (const k of await keys(env.DATA)) await env.DATA.delete(k);
    for (const k of await keys(env.BACKUP)) await env.BACKUP.delete(k); // test-only; the real bucket is locked

    const a = await claimVault(server);
    await a.client.post('/api/blobs', fakeBlob());
    await worker.scheduled({ cron: '17 3 * * *' });
    const oldId = await vaultIdOf(env.DATA);
    const oldSnapshot = Object.fromEntries((await env.BACKUP.list()).objects.map((o) => [o.key, o.etag]));
    expect(Object.keys(oldSnapshot).length).toBeGreaterThan(3);
    expect(Object.keys(oldSnapshot).every((k) => k.startsWith(`vault/${oldId}/`))).toBe(true);

    // Owner wipes DATA by hand and claims the instance again: same fixed keys, new vault.
    for (const k of await keys(env.DATA)) await env.DATA.delete(k);
    const b = await claimVault(server);
    await b.client.post('/api/blobs', fakeBlob());
    const newId = await vaultIdOf(env.DATA);
    expect(newId).not.toBe(oldId);
    await worker.scheduled({ cron: '17 3 * * *' });

    const wanted = (await keys(env.DATA)).filter((k) => !/^(used|revoked|backup-progress)\//.test(k));
    expect(wanted).toContain('meta/claimed');
    const all = (await env.BACKUP.list({ limit: 1000 })).objects;
    const mine = all.filter((o) => o.key.startsWith(`vault/${newId}/`)).map((o) => o.key.slice(`vault/${newId}/`.length)).sort();
    expect(mine).toEqual(wanted);
    expect(await text(env.BACKUP, `vault/${newId}/meta/claimed`)).toBe(await text(env.DATA, 'meta/claimed'));
    for (const o of all.filter((o) => o.key.startsWith(`vault/${oldId}/`))) expect(o.etag).toBe(oldSnapshot[o.key]);
    expect(all.length).toBe(Object.keys(oldSnapshot).length + wanted.length);
    expect((await env.DATA.list({ prefix: `backup-progress/${newId}/` })).objects.length).toBeGreaterThan(0);
  });
});
