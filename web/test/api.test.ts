import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe('api error mapping', () => {
  it('maps 422 to ApiError with field errors', async () => {
    mockFetch(422, { errors: { name: 'Pflichtfeld' } });
    const e = await api.createFeature('x', {}).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(422);
    expect(e.errors).toEqual({ name: 'Pflichtfeld' });
  });
  it('maps 404 without errors', async () => {
    mockFetch(404, { error: 'Nicht gefunden' });
    const e = await api.listFeatures('x').catch((x) => x);
    expect(e).toMatchObject({ status: 404, errors: undefined, message: 'Nicht gefunden' });
  });
  it('tolerates non-JSON error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const e = await api.getConfig().catch((x) => x);
    expect(e).toMatchObject({ status: 500 });
  });
  it('returns undefined on 204', async () => {
    mockFetch(204);
    await expect(api.deleteFeature('x', 1)).resolves.toBeUndefined();
  });
  it('builds photo urls', () => {
    expect(api.photoUrl('a')).toBe('/api/photos/a');
    expect(api.thumbUrl('a')).toBe('/api/photos/a/thumb');
  });
});
