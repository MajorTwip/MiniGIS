import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { userFromHeaders } from '../src/identity.js';

const CONFIG_PATH = new URL('../../config/minigis.yaml', import.meta.url).pathname;
let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'minigis-api-'));
  const config = loadConfig(CONFIG_PATH);
  config.app.maxPhotoMb = 1;
  app = await buildApp({ config, dataDir: dir, logger: false });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const point = { type: 'Point', coordinates: [2613500, 1185100] };
const poly = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] };

async function mkContainer(headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layers/abfallcontainer/features',
    headers,
    payload: { type: 'Feature', geometry: point, properties: { nummer: 'A-12', typ: 'Glas' } },
  });
  return res;
}

function multipartBody(files: Array<{ name: string; type: string; data: Buffer }>) {
  const b = '----minigistest';
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
const jpg = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: '#4a8' } }).jpeg().toBuffer();

describe('userFromHeaders', () => {
  it('is case-insensitive and takes the first array value', () => {
    expect(userFromHeaders({ 'x-authentik-username': 'anna' }, 'X-Authentik-Username')).toBe('anna');
    expect(userFromHeaders({ 'X-AUTHENTIK-USERNAME': ['a', 'b'] }, 'x-authentik-username')).toBe('a');
    expect(userFromHeaders({}, 'x-authentik-username')).toBeNull();
  });
});

describe('API', () => {
  it('health and config', async () => {
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
    const cfg = (await app.inject('/api/config')).json();
    expect(cfg.app.title).toBe('MiniGIS Brenzikofen');
    expect(Object.keys(cfg.layers)).toEqual(['abfallcontainer', 'neophyten']);
  });

  it('POST records the identity header, or null without it', async () => {
    const a = await mkContainer({ 'x-authentik-username': 'anna' });
    expect(a.statusCode).toBe(201);
    expect(a.json().properties.created_by).toBe('anna');
    expect((await mkContainer()).json().properties.created_by).toBeNull();
  });

  it('POST invalid returns 422 with field errors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/layers/abfallcontainer/features',
      payload: { geometry: point, properties: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.nummer).toBeTruthy();
  });

  it('malformed geometry body is 422, not 500', async () => {
    for (const geometry of [{ type: 'Polygon', coordinates: [null] }, 'x', 5]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/layers/neophyten/features',
        payload: { geometry, properties: {} },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().errors.geometry).toBe('Ungültige Geometrie');
    }
    const res = await app.inject({ method: 'POST', url: '/api/layers/neophyten/features', payload: [1] });
    expect(res.statusCode).toBe(422);
  });

  it('PUT, GET, DELETE round trip with correct codes', async () => {
    const fid = (await mkContainer()).json().id;
    const put = await app.inject({
      method: 'PUT',
      url: `/api/layers/abfallcontainer/features/${fid}`,
      payload: { properties: { nummer: 'B-1' } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().properties.nummer).toBe('B-1');
    const list = (await app.inject('/api/layers/abfallcontainer/features')).json();
    expect(list.features).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/layers/abfallcontainer/features/${fid}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/layers/abfallcontainer/features/${fid}` })).statusCode).toBe(404);
  });

  it('404 for unknown fid, layer and bad fid', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/layers/abfallcontainer/features/999', payload: {} });
    expect(put.statusCode).toBe(404);
    expect((await app.inject('/api/layers/nope/features')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/layers/nope/features', payload: [] })).statusCode).toBe(404);
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect((await app.inject({ method: 'PUT', url: `/api/layers/abfallcontainer/features/${bad}`, payload: {} })).statusCode).toBe(404);
    }
  });

  it('validates bbox', async () => {
    await mkContainer();
    for (const bbox of ['1,2,3', 'a,b,c,d', '5,0,1,10', '0,5,10,1', '1,2,3,Infinity']) {
      const res = await app.inject(`/api/layers/abfallcontainer/features?bbox=${bbox}`);
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ errors: { bbox: 'Ungültige BBox' } });
    }
    const inside = await app.inject('/api/layers/abfallcontainer/features?bbox=2613000,1185000,2614000,1186000');
    expect(inside.json().features).toHaveLength(1);
    const outside = await app.inject('/api/layers/abfallcontainer/features?bbox=0,0,1,1');
    expect(outside.json().features).toHaveLength(0);
  });

  it('uploads photos, serves them, and cascades on feature delete', async () => {
    const fid = (await mkContainer()).json().id;
    const url = `/api/layers/abfallcontainer/features/${fid}/photos`;
    const up = await app.inject({
      method: 'POST',
      url,
      ...multipartBody([
        { name: 'Foto Ä.jpg', type: 'image/jpeg', data: await jpg() },
        { name: 'b.jpg', type: 'image/jpeg', data: await jpg() },
      ]),
    });
    expect(up.statusCode).toBe(201);
    expect(up.json()).toHaveLength(2);
    expect(up.json()[0].filename).toBe('Foto Ä.jpg');
    const list = (await app.inject(url)).json();
    expect(list).toHaveLength(2);
    const id = list[0].id;
    const thumb = await app.inject(`/api/photos/${id}/thumb`);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(thumb.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect((await app.inject(`/api/photos/${id}`)).statusCode).toBe(200);

    await app.inject({ method: 'DELETE', url: `/api/layers/abfallcontainer/features/${fid}` });
    expect((await app.inject(`/api/photos/${id}`)).statusCode).toBe(404);
    expect((await app.inject(`/api/photos/${id}/thumb`)).statusCode).toBe(404);
  });

  it('returns 404 when the photo file is missing on disk', async () => {
    const fid = (await mkContainer()).json().id;
    const url = `/api/layers/abfallcontainer/features/${fid}/photos`;
    await app.inject({
      method: 'POST',
      url,
      ...multipartBody([{ name: 'a.jpg', type: 'image/jpeg', data: await jpg() }]),
    });
    const id = (await app.inject(url)).json()[0].id;
    rmSync(join(dir, 'photos'), { recursive: true, force: true });
    expect((await app.inject(`/api/photos/${id}`)).statusCode).toBe(404);
    expect((await app.inject(`/api/photos/${id}/thumb`)).statusCode).toBe(404);
  });

  it('answers 413 with a files message when more than 20 files are uploaded', async () => {
    const fid = (await mkContainer()).json().id;
    const data = await jpg();
    const res = await app.inject({
      method: 'POST',
      url: `/api/layers/abfallcontainer/features/${fid}/photos`,
      ...multipartBody(Array.from({ length: 21 }, (_, i) => ({ name: `${i}.jpg`, type: 'image/jpeg', data }))),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().errors.file).toBe('Zu viele Dateien (max. 20)');
  });

  it('deletes a single photo', async () => {
    const fid = (await mkContainer()).json().id;
    const up = await app.inject({
      method: 'POST',
      url: `/api/layers/abfallcontainer/features/${fid}/photos`,
      ...multipartBody([{ name: 'a.jpg', type: 'image/jpeg', data: await jpg() }]),
    });
    const id = up.json()[0].id;
    expect((await app.inject({ method: 'DELETE', url: `/api/photos/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/photos/${id}` })).statusCode).toBe(404);
  });

  it('rejects oversize (413) and non-image (415) uploads', async () => {
    const fid = (await mkContainer()).json().id;
    const url = `/api/layers/abfallcontainer/features/${fid}/photos`;
    const big = await app.inject({
      method: 'POST',
      url,
      ...multipartBody([{ name: 'big.jpg', type: 'image/jpeg', data: Buffer.alloc(1024 * 1024 + 10, 1) }]),
    });
    expect(big.statusCode).toBe(413);
    const txt = await app.inject({
      method: 'POST',
      url,
      ...multipartBody([{ name: 'a.txt', type: 'text/plain', data: Buffer.from('hello') }]),
    });
    expect(txt.statusCode).toBe(415);
    expect(txt.json()).toEqual({ errors: { file: 'Nur JPEG, PNG oder WebP' } });
  });

  it('mixed batch (jpg + txt) is all-or-nothing', async () => {
    const fid = (await mkContainer()).json().id;
    const url = `/api/layers/abfallcontainer/features/${fid}/photos`;
    const res = await app.inject({
      method: 'POST',
      url,
      ...multipartBody([
        { name: 'a.jpg', type: 'image/jpeg', data: await jpg() },
        { name: 'a.txt', type: 'text/plain', data: Buffer.from('hello') },
      ]),
    });
    expect(res.statusCode).toBe(415);
    expect((await app.inject(url)).json()).toHaveLength(0);
  });

  it('photo routes 404 for unknown layer, unknown feature and path-traversal layer', async () => {
    const up = async (layer: string, fid: number | string) =>
      app.inject({
        method: 'POST',
        url: `/api/layers/${layer}/features/${fid}/photos`,
        ...multipartBody([{ name: 'a.jpg', type: 'image/jpeg', data: await jpg() }]),
      });
    expect((await up('nope', 1)).statusCode).toBe(404);
    expect((await up('abfallcontainer', 999)).statusCode).toBe(404);
    expect((await up('..%2F..', 1)).statusCode).toBe(404);
    expect((await app.inject('/api/layers/nope/features/1/photos')).statusCode).toBe(404);
  });
});

describe('static serving', () => {
  it('serves SPA fallback for non-api paths and JSON 404 for /api', async () => {
    const sdir = mkdtempSync(join(tmpdir(), 'minigis-static-'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(sdir, 'index.html'), '<html>spa</html>');
    const a = await buildApp({ config: loadConfig(CONFIG_PATH), dataDir: mkdtempSync(join(tmpdir(), 'mg-')), staticDir: sdir, logger: false });
    try {
      expect((await a.inject('/')).body).toContain('spa');
      expect((await a.inject('/some/route')).body).toContain('spa');
      const api = await a.inject('/api/nothing');
      expect(api.statusCode).toBe(404);
      expect(api.headers['content-type']).toContain('application/json');
    } finally {
      await a.close();
      rmSync(sdir, { recursive: true, force: true });
    }
  });
});
