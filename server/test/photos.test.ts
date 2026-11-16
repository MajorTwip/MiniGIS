import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type gdal from 'gdal-async';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Mutex, openGpkg, syncSchema } from '../src/storage/db.js';
import { FeatureStore } from '../src/storage/features.js';
import { PhotoStore, UnsupportedTypeError } from '../src/storage/photos.js';

const CONFIG_PATH = new URL('../../config/minigis.yaml', import.meta.url).pathname;
let dir: string;
let ds: gdal.Dataset;
let store: PhotoStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'minigis-photo-'));
  ds = await openGpkg(join(dir, 'test.gpkg'));
  syncSchema(ds, loadConfig(CONFIG_PATH));
  store = new PhotoStore(ds, dir, new Mutex());
});
afterEach(() => {
  ds.close();
  rmSync(dir, { recursive: true, force: true });
});

const img = (format: 'jpeg' | 'png', w = 1200, h = 800) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#4a8' } })[format]().toBuffer();

describe('PhotoStore', () => {
  it('add stores file and thumbnail', async () => {
    const data = await img('jpeg');
    const m = await store.add('abfallcontainer', 1, { filename: 'Foto Ä.jpg', contentType: 'image/jpeg', data }, 'alice');
    expect(m.filename).toBe('Foto Ä.jpg');
    expect(m.size).toBe(data.length);
    expect(m.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(m.createdBy).toBe('alice');
    const got = await store.get(m.id);
    expect(got?.meta).toEqual(m);
    expect(existsSync(got!.path)).toBe(true);
    expect(got!.path).toBe(join(dir, 'photos', 'abfallcontainer', '1', `${m.id}.jpg`));
    expect(existsSync(got!.thumbPath)).toBe(true);
    const t = await sharp(got!.thumbPath).metadata();
    expect(Math.max(t.width!, t.height!)).toBeLessThanOrEqual(400);
    expect((await store.list('abfallcontainer', 1)).map((p) => p.id)).toEqual([m.id]);
  });

  it('rejects image/heic', async () => {
    await expect(
      store.add('abfallcontainer', 1, { filename: 'a.heic', contentType: 'image/heic', data: Buffer.from('not an image') }, null),
    ).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  it('content sniffing: a .jpg name with PNG bytes is stored as image/png', async () => {
    const m = await store.add('abfallcontainer', 1, { filename: 'x.jpg', contentType: 'image/jpeg', data: await img('png') }, null);
    expect(m.contentType).toBe('image/png');
    expect((await store.get(m.id))!.path.endsWith('.png')).toBe(true);
  });

  it('get returns null for unknown id', async () => {
    expect(await store.get('nope')).toBeNull();
    expect(await store.delete('nope')).toBe(false);
  });

  it('delete removes files and row', async () => {
    const m = await store.add('abfallcontainer', 1, { filename: 'a.jpg', contentType: 'image/jpeg', data: await img('jpeg') }, null);
    const got = (await store.get(m.id))!;
    expect(await store.delete(m.id)).toBe(true);
    expect(existsSync(got.path)).toBe(false);
    expect(existsSync(got.thumbPath)).toBe(false);
    expect(existsSync(join(dir, 'photos', 'abfallcontainer', '1'))).toBe(false);
    expect(await store.get(m.id)).toBeNull();
  });

  it('deleteForFeature removes all photos of that feature only', async () => {
    const f = { filename: 'a.jpg', contentType: 'image/jpeg', data: await img('jpeg', 100, 100) };
    const a1 = await store.add('abfallcontainer', 1, f, null);
    const a2 = await store.add('abfallcontainer', 1, f, null);
    const b = await store.add('abfallcontainer', 2, f, null);
    const pa1 = (await store.get(a1.id))!;
    await store.deleteForFeature('abfallcontainer', 1);
    expect(await store.list('abfallcontainer', 1)).toEqual([]);
    expect(await store.get(a2.id)).toBeNull();
    expect(existsSync(pa1.path)).toBe(false);
    expect(existsSync(join(dir, 'photos', 'abfallcontainer', '1'))).toBe(false);
    expect((await store.get(b.id))?.meta.id).toBe(b.id);
  });

  it('works as FeatureStore.delete onDelete without deadlock', async () => {
    const mutex = new Mutex();
    const config = loadConfig(CONFIG_PATH);
    const fs = new FeatureStore(ds, config, mutex);
    const ps = new PhotoStore(ds, dir, mutex);
    const feat = await fs.create('abfallcontainer', { geometry: { type: 'Point', coordinates: [2613500, 1185100] }, properties: { nummer: 'A-1', typ: 'Grüngut' } }, null);
    const m = await ps.add('abfallcontainer', feat.id as number, { filename: 'a.jpg', contentType: 'image/jpeg', data: await img('jpeg', 50, 50) }, null);
    expect(await fs.delete('abfallcontainer', feat.id as number, (l, i) => ps.deleteForFeature(l, i))).toBe(true);
    expect(await ps.get(m.id)).toBeNull();
  });
});
