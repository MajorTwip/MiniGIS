import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gdal from 'gdal-async';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@minigis/shared';
import { loadConfig } from '../src/config.js';
import { Mutex, openGpkg, syncSchema } from '../src/storage/db.js';

const CONFIG_PATH = new URL('../../config/minigis.yaml', import.meta.url).pathname;

let dir: string;
let file: string;
let config: AppConfig;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'minigis-db-'));
  file = join(dir, 'test.gpkg');
  config = structuredClone(loadConfig(CONFIG_PATH));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('syncSchema', () => {
  it('creates tables', async () => {
    const ds = await openGpkg(file);
    syncSchema(ds, config);
    const names = ds.layers.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['abfallcontainer', 'neophyten', 'photos']));
    const l = ds.layers.get('abfallcontainer');
    expect(l.geomType).toBe(gdal.wkbPoint);
    expect(l.srs?.getAuthorityCode()).toBe('2056');
    const fields = l.fields.map((f) => f.name);
    expect(fields).toEqual(expect.arrayContaining(['nummer', 'created_by', 'created_at', 'updated_at', 'updated_by']));
    expect(ds.layers.get('neophyten').geomType).toBe(gdal.wkbPolygon);
    const photos = ds.layers.get('photos').fields.map((f) => f.name);
    expect(photos).toEqual(
      expect.arrayContaining(['id', 'layer', 'feature_id', 'filename', 'content_type', 'size', 'created_at', 'created_by']),
    );
    ds.close();
  });

  it('adds new column, keeps data', async () => {
    let ds = await openGpkg(file);
    syncSchema(ds, config);
    const layer = ds.layers.get('abfallcontainer');
    const f = new gdal.Feature(layer);
    f.setGeometry(new gdal.Point(2613500, 1185100));
    layer.features.add(f);
    ds.close();

    config.layers.abfallcontainer.attributes.push({ name: 'farbe', type: 'text' });
    ds = await openGpkg(file);
    syncSchema(ds, config);
    const l = ds.layers.get('abfallcontainer');
    expect(l.features.count()).toBe(1);
    expect(l.fields.map((x) => x.name)).toContain('farbe');
    ds.close();
  });

  it('rejects a changed attribute type', async () => {
    let ds = await openGpkg(file);
    syncSchema(ds, config);
    ds.close();
    const attrs = config.layers.abfallcontainer.attributes;
    const a = attrs.find((x) => x.type === 'integer')!;
    a.type = 'number';
    ds = await openGpkg(file);
    expect(() => syncSchema(ds, config)).toThrow(new RegExp(`abfallcontainer.*${a.name}.*Rename`));
    ds.close();
  });

  it('rejects a changed geometry type', async () => {
    let ds = await openGpkg(file);
    syncSchema(ds, config);
    ds.close();
    config.layers.abfallcontainer.geometry = 'polygon';
    ds = await openGpkg(file);
    expect(() => syncSchema(ds, config)).toThrow(/abfallcontainer.*geometry/);
    ds.close();
  });

  it('accepts an unchanged config on re-sync', async () => {
    let ds = await openGpkg(file);
    syncSchema(ds, config);
    ds.close();
    ds = await openGpkg(file);
    expect(() => syncSchema(ds, config)).not.toThrow();
    ds.close();
  });

  it('never drops', async () => {
    let ds = await openGpkg(file);
    syncSchema(ds, config);
    ds.close();
    config.layers.abfallcontainer.attributes = config.layers.abfallcontainer.attributes.filter(
      (a) => a.name !== 'bemerkung',
    );
    ds = await openGpkg(file);
    syncSchema(ds, config);
    expect(ds.layers.get('abfallcontainer').fields.map((f) => f.name)).toContain('bemerkung');
    ds.close();
  });

  it('reopens readonly', async () => {
    const ds = await openGpkg(file);
    syncSchema(ds, config);
    ds.flush();
    const ro = gdal.open(file);
    expect(ro.layers.map((l) => l.name)).toEqual(
      expect.arrayContaining(['abfallcontainer', 'neophyten', 'photos']),
    );
    ro.close();
    ds.close();
  });
});

describe('openGpkg', () => {
  it('puts the file in WAL mode', async () => {
    const ds = await openGpkg(file);
    syncSchema(ds, config);
    ds.flush();
    // SQLite header bytes 18-19 are 2 when the database is in WAL mode.
    const header = readFileSync(file).subarray(18, 20);
    expect([...header]).toEqual([2, 2]);
    ds.close();
  });
});

describe('photos unique id', () => {
  it('has the photos_id index and rejects duplicate ids', async () => {
    const ds = await openGpkg(file);
    syncSchema(ds, config);
    syncSchema(ds, config); // idempotent
    const idx = ds.executeSQL("SELECT name FROM sqlite_master WHERE type='index' AND name='photos_id'");
    expect(idx?.features.count()).toBe(1);
    const photos = ds.layers.get('photos');
    const add = () => {
      const f = new gdal.Feature(photos);
      f.fields.set('id', 'same-uuid');
      photos.features.add(f);
      photos.flush();
    };
    add();
    expect(add).toThrow();
    expect(photos.features.count()).toBe(1);
    ds.close();
  });
});

describe('Mutex', () => {
  it('serialises', async () => {
    const m = new Mutex();
    const log: string[] = [];
    const a = m.run(async () => {
      log.push('a start');
      await new Promise((r) => setTimeout(r, 30));
      log.push('a end');
    });
    const b = m.run(async () => {
      log.push('b start');
      log.push('b end');
    });
    await Promise.all([a, b]);
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end']);
  });
});
