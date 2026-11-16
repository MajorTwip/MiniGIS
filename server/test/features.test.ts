import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type gdal from 'gdal-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@minigis/shared';
import { loadConfig } from '../src/config.js';
import { Mutex, openGpkg, syncSchema } from '../src/storage/db.js';
import { FeatureStore, UnknownLayerError, ValidationError } from '../src/storage/features.js';

const CONFIG_PATH = new URL('../../config/minigis.yaml', import.meta.url).pathname;

let dir: string;
let ds: gdal.Dataset;
let config: AppConfig;
let store: FeatureStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'minigis-feat-'));
  config = structuredClone(loadConfig(CONFIG_PATH));
  ds = await openGpkg(join(dir, 'test.gpkg'));
  syncSchema(ds, config);
  store = new FeatureStore(ds, config, new Mutex());
});
afterEach(() => {
  ds.close();
  rmSync(dir, { recursive: true, force: true });
});

const pt = (x: number, y: number) => ({ type: 'Point' as const, coordinates: [x, y] });
const poly = (ring: number[][]) => ({ type: 'Polygon' as const, coordinates: [ring] });
const square = (x: number, y: number, s = 10) =>
  poly([[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]);

async function rejects(p: Promise<unknown>): Promise<ValidationError> {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(ValidationError);
  return e as ValidationError;
}

describe('FeatureStore', () => {
  it('CRUD round trip on abfallcontainer', async () => {
    const created = await store.create(
      'abfallcontainer',
      { geometry: pt(2613500, 1185100), properties: { nummer: 'A-12', typ: 'Grüngut' } },
      'alice',
    );
    expect(typeof created.id).toBe('number');
    expect(created.properties?.created_by).toBe('alice');
    expect(created.properties?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const got = await store.get('abfallcontainer', created.id as number);
    expect(got?.geometry).toEqual(pt(2613500, 1185100));
    expect(got?.properties?.typ).toBe('Grüngut');
    expect(got?.properties?.nummer).toBe('A-12');

    const upd = await store.update(
      'abfallcontainer',
      created.id as number,
      { geometry: pt(2613510, 1185110) },
      'bob',
    );
    expect(upd?.geometry).toEqual(pt(2613510, 1185110));
    expect(upd?.properties?.updated_by).toBe('bob');
    expect(upd?.properties?.created_by).toBe('alice');
    expect(upd?.properties?.created_at).toBe(created.properties?.created_at);
    expect(upd?.properties?.nummer).toBe('A-12');

    const onDelete = vi.fn(async () => undefined);
    expect(await store.delete('abfallcontainer', created.id as number, onDelete)).toBe(true);
    expect(onDelete).toHaveBeenCalledWith('abfallcontainer', created.id);
    expect(await store.get('abfallcontainer', created.id as number)).toBeNull();
    expect(await store.delete('abfallcontainer', created.id as number, onDelete)).toBe(false);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('update merges properties and validates the merged set', async () => {
    const c = await store.create(
      'abfallcontainer',
      { geometry: pt(1, 1), properties: { nummer: 'A-1', volumen: 100 } },
      null,
    );
    const u = await store.update('abfallcontainer', c.id as number, { properties: { typ: 'Glas' } }, null);
    expect(u?.properties).toMatchObject({ nummer: 'A-1', volumen: 100, typ: 'Glas' });
    const e = await rejects(
      store.update('abfallcontainer', c.id as number, { properties: { nummer: '' } }, null),
    );
    expect(e.errors).toHaveProperty('nummer');
    expect(await store.update('abfallcontainer', 9999, { properties: {} }, null)).toBeNull();
  });

  it('polygon round trip with date and boolean', async () => {
    const g = square(2613000, 1185000);
    const c = await store.create(
      'neophyten',
      {
        geometry: g,
        properties: { art: 'Drüsiges Springkraut', gefunden: '2026-07-04', bekaempft: true },
      },
      null,
    );
    const got = await store.get('neophyten', c.id as number);
    expect(got?.geometry?.type).toBe('Polygon');
    expect((got?.geometry as { coordinates: number[][][] }).coordinates[0]).toHaveLength(5);
    expect(got?.properties?.art).toBe('Drüsiges Springkraut');
    expect(got?.properties?.gefunden).toBe('2026-07-04');
    expect(got?.properties?.bekaempft).toBe(true);
    const u = await store.update('neophyten', c.id as number, { properties: { bekaempft: false } }, null);
    expect(u?.properties?.bekaempft).toBe(false);
    expect(u?.properties?.created_by).toBeNull();
  });

  it('wrong geometry type', async () => {
    const e = await rejects(
      store.create('neophyten', { geometry: pt(1, 1), properties: { gefunden: '2026-07-04' } }, null),
    );
    expect(e.errors).toHaveProperty('geometry');
  });

  it('degenerate polygon', async () => {
    const e = await rejects(
      store.create(
        'neophyten',
        { geometry: poly([[0, 0], [1, 1], [0, 0], [0, 0]]), properties: { gefunden: '2026-07-04' } },
        null,
      ),
    );
    expect(e.errors).toHaveProperty('geometry');
    expect((await store.list('neophyten')).features).toHaveLength(0);
  });

  it('missing geometry on create', async () => {
    const e = await rejects(
      store.create('abfallcontainer', { properties: { nummer: 'x' } } as never, null),
    );
    expect(e.errors).toHaveProperty('geometry');
  });

  it('required attribute', async () => {
    const e = await rejects(store.create('abfallcontainer', { geometry: pt(1, 1), properties: {} }, null));
    expect(e.errors).toHaveProperty('nummer');
  });

  it('combines geometry and attribute errors', async () => {
    const e = await rejects(store.create('abfallcontainer', { properties: {} } as never, null));
    expect(Object.keys(e.errors).sort()).toEqual(['geometry', 'nummer']);
  });

  it('bbox filter', async () => {
    await store.create('abfallcontainer', { geometry: pt(10, 10), properties: { nummer: 'in' } }, null);
    await store.create('abfallcontainer', { geometry: pt(500, 500), properties: { nummer: 'out' } }, null);
    const all = await store.list('abfallcontainer');
    expect(all.features).toHaveLength(2);
    const some = await store.list('abfallcontainer', [0, 0, 100, 100]);
    expect(some.features.map((f) => f.properties?.nummer)).toEqual(['in']);
  });

  it('hidden column is not returned', async () => {
    await store.create(
      'abfallcontainer',
      { geometry: pt(1, 1), properties: { nummer: 'A', bemerkung: 'geheim' } },
      null,
    );
    expect((await store.list('abfallcontainer')).features[0].properties).toHaveProperty('bemerkung');
    config.layers.abfallcontainer.attributes = config.layers.abfallcontainer.attributes.filter(
      (a) => a.name !== 'bemerkung',
    );
    const f = (await store.list('abfallcontainer')).features[0];
    expect(f.properties).not.toHaveProperty('bemerkung');
    expect(f.properties).toHaveProperty('nummer');
  });

  it('unknown layer', async () => {
    await expect(store.list('nope')).rejects.toBeInstanceOf(UnknownLayerError);
    await expect(store.get('nope', 1)).rejects.toBeInstanceOf(UnknownLayerError);
    await expect(
      store.create('nope', { geometry: pt(1, 1), properties: {} }, null),
    ).rejects.toBeInstanceOf(UnknownLayerError);
    await expect(store.delete('nope', 1)).rejects.toBeInstanceOf(UnknownLayerError);
  });
});

describe('malformed nested coordinates', () => {
  it('are rejected as invalid geometry instead of throwing TypeError', async () => {
    await expect(
      store.create('neophyten', { geometry: { type: 'Polygon', coordinates: [null] } as never, properties: {} }, null),
    ).rejects.toMatchObject({ errors: { geometry: 'Ungültige Geometrie' } });
  });
});
