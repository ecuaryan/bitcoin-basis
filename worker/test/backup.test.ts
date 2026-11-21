import type { R2Bucket } from '@cloudflare/workers-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimVault, fakeBlob, startServer } from './harness.ts';

const server = startServer();
beforeAll(() => server.listen(), 60_000);
afterAll(() => server.close());

type Buckets = { DATA: R2Bucket; BACKUP: R2Bucket };
const keys = async (b: R2Bucket) => (await b.list({ limit: 1000 })).objects.map((o) => o.key).sort();
const text = async (b: R2Bucket, key: string) => (await b.get(key))?.text();

describe('daily backup cron', () => {
  it('copies objects missing from BACKUP, skips challenge markers, and never overwrites', async () => {
    const { client } = await claimVault(server); // writes meta/claimed, recovery/000001, cred/<id>, used/<challenge>
    const ups: string[] = [];
    for (let i = 0; i < 3; i++) ups.push((await client.post('/api/blobs', fakeBlob())).data.key as string);
    const first = ups[0] ?? '';
    const worker = server.getWorker<Buckets>();
    const env = await worker.getEnv();

    // An object already in BACKUP under the same key must survive untouched.
    await env.BACKUP.put(first, 'pre-existing backup bytes');

    await worker.scheduled({ cron: '17 3 * * *' });
    const wanted = (await keys(env.DATA)).filter((k) => !k.startsWith('used/') && !k.startsWith('backup-progress/'));
    expect(wanted.some((k) => k.startsWith('cred/'))).toBe(true);
    expect(wanted).toContain('meta/claimed');
    expect(wanted).toContain('recovery/000001');
    expect(wanted.some((k) => k.startsWith('epoch/000001/cred/'))).toBe(true);
    expect(await keys(env.BACKUP)).toEqual(wanted);
    expect(await text(env.BACKUP, first)).toBe('pre-existing backup bytes');
    for (const k of wanted.slice(1).filter((k) => k !== ups[0])) expect(await text(env.BACKUP, k)).toBe(await text(env.DATA, k));

    // A second run copies only what's new.
    const etags = Object.fromEntries((await env.BACKUP.list()).objects.map((o) => [o.key, o.etag]));
    const late = (await client.post('/api/blobs', fakeBlob())).data.key as string;
    await worker.scheduled({ cron: '17 3 * * *' });
    const after = (await env.BACKUP.list()).objects;
    expect(after.map((o) => o.key).sort()).toEqual([...wanted, late].sort());
    for (const o of after) if (o.key !== late) expect(o.etag).toBe(etags[o.key]);

    // Each run leaves an append-only progress marker (newest lists first) with the last e/ key reached.
    const markers = (await env.DATA.list({ prefix: 'backup-progress/' })).objects.map((o) => o.key);
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
    expect(backedUp).toContain(nearKey);
    expect(backedUp).not.toContain('e/0000000000001-0000000000000000');
    expect(backedUp.some((k) => k.startsWith('used/') || k.startsWith('revoked/') || k.startsWith('backup-progress/'))).toBe(false);
  });
});
