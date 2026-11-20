import { describe, expect, test } from 'vitest';
import { ApiError, createApiClient } from './api.ts';
import { fromBase64Url, randomBytes, toBase64, toBase64Url } from './bytes.ts';

type Call = { url: string; init: RequestInit };
function client(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const api = createApiClient({ fetch: (url, init) => (calls.push({ url, init }), Promise.resolve(respond({ url, init }))) });
  return { api, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

describe('api client', () => {
  test('same-origin credentials, JSON content type, octet-stream for blobs', async () => {
    const { api, calls } = client((c) => json(c.url === '/api/blobs' ? { key: 'e/1' } : { claimed: false }, 201));
    await api.status();
    await api.uploadBlob(randomBytes(1053));
    await api.recoveryLogin('tok').catch(() => undefined);
    expect(calls[0]).toMatchObject({ url: '/api/status', init: { method: 'GET', credentials: 'same-origin' } });
    expect(calls[1]?.init.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' });
    expect(calls[2]?.init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"authToken":"tok"}' });
  });

  test('HTTP failures become typed errors', async () => {
    for (const [status, kind] of [
      [400, 'bad-request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [409, 'conflict'],
      [413, 'too-large'],
      [500, 'server'],
    ] as const) {
      const { api } = client(() => json({ error: 'x' }, status));
      await expect(api.status()).rejects.toMatchObject({ name: 'ApiError', kind, status });
    }
    const offline = createApiClient({ fetch: () => Promise.reject(new TypeError('fetch failed')) });
    await expect(offline.status()).rejects.toMatchObject({ kind: 'network', status: null });
    const { api } = client(() => new Response('<html>', { status: 200 }));
    await expect(api.status()).rejects.toMatchObject({ kind: 'bad-response' });
  });

  test('blob listing: query, base64url data, order checked', async () => {
    const data = randomBytes(40);
    const { api, calls } = client(() => json({ blobs: [{ key: 'e/2', data: toBase64Url(data) }, { key: 'e/3', data: toBase64(data) }], more: false }));
    const page = await api.listBlobs('e/1', 500);
    expect(calls[0]?.url).toBe('/api/blobs?limit=200&after=e%2F1');
    expect(page.blobs.map((b) => b.key)).toEqual(['e/2', 'e/3']);
    expect(page.blobs[1]?.data).toEqual(data);
    const bad = client(() => json({ blobs: [{ key: 'e/3', data: '' }, { key: 'e/2', data: '' }], more: false }));
    await expect(bad.api.listBlobs(null)).rejects.toBeInstanceOf(ApiError);
    const behind = client(() => json({ blobs: [{ key: 'e/0', data: '' }], more: false }));
    await expect(behind.api.listBlobs('e/1')).rejects.toMatchObject({ kind: 'bad-response' });
  });

  test('base64url helpers round trip and reject junk', () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      expect(fromBase64Url(toBase64Url(b))).toEqual(b);
      expect(fromBase64Url(toBase64(b))).toEqual(b);
      expect(toBase64Url(b)).toBe(Buffer.from(b).toString('base64url'));
    }
    expect(() => fromBase64Url('a')).toThrow(TypeError);
    expect(() => fromBase64Url('ab!c')).toThrow(TypeError);
    expect(() => fromBase64Url('AB')).toThrow(TypeError); // non-zero trailing bits
  });
});
