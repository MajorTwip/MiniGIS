import { existsSync } from 'node:fs';
import gdal from 'gdal-async';
import type { AppConfig, AttributeDef } from '@minigis/shared';
import { ConfigError } from '../config.js';

const GEOM_TYPES = {
  point: gdal.wkbPoint,
  line: gdal.wkbLineString,
  polygon: gdal.wkbPolygon,
} as const;

/** Serialises async work: each run starts after the previous one finished. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export function fieldTypeFor(attr: AttributeDef): string {
  switch (attr.type) {
    case 'integer':
    case 'boolean':
      return gdal.OFTInteger;
    case 'number':
      return gdal.OFTReal;
    case 'date':
      return gdal.OFTDate;
    default:
      return gdal.OFTString;
  }
}

function addField(layer: gdal.Layer, name: string, type: string): void {
  if (layer.fields.indexOf(name) >= 0) return;
  layer.fields.add(new gdal.FieldDefn(name, type));
}

export function findLayer(ds: gdal.Dataset, name: string): gdal.Layer | null {
  return ds.layers.map((l) => l.name).includes(name) ? ds.layers.get(name) : null;
}

/**
 * gdal-async throws an empty Error after DDL statements that return no result set,
 * even when the statement succeeded. So verify through sqlite_master instead of
 * trusting the exception.
 */
function ensurePhotosIdIndex(ds: gdal.Dataset): void {
  const exists = () => {
    const res = ds.executeSQL("SELECT name FROM sqlite_master WHERE type='index' AND name='photos_id'");
    const found = (res?.features.count() ?? 0) > 0;
    return found;
  };
  if (exists()) return;
  try {
    ds.executeSQL('CREATE UNIQUE INDEX photos_id ON photos(id)');
  } catch {
    /* see above */
  }
  if (!exists()) throw new Error('could not create unique index photos_id');
}

export async function openGpkg(file: string): Promise<gdal.Dataset> {
  const ds = existsSync(file)
    ? gdal.open(file, 'r+', 'GPKG')
    : gdal.drivers.get('GPKG').create(file);
  const res = ds.executeSQL('PRAGMA journal_mode=WAL');
  const mode = String(res?.features.first()?.fields.get(0) ?? '');
  if (mode.toLowerCase() !== 'wal') {
    ds.close();
    throw new Error(`could not enable WAL journal mode on ${file} (got "${mode}")`);
  }
  return ds;
}

/** Stored schema differs from the config in a way schema sync cannot migrate. Fatal at startup. */
export class SchemaMismatchError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

const GEOM_NAMES = new Map<number, string>([
  [gdal.wkbPoint, 'point'],
  [gdal.wkbLineString, 'line'],
  [gdal.wkbPolygon, 'polygon'],
]);

function checkExisting(layer: gdal.Layer, id: string, def: AppConfig['layers'][string]): void {
  const stored = GEOM_NAMES.get(layer.geomType) ?? String(layer.geomType);
  if (layer.geomType !== GEOM_TYPES[def.geometry]) {
    throw new SchemaMismatchError(
      `Layer "${id}": stored geometry type is ${stored}, configured is ${def.geometry}. ` +
        `Use a new layer id instead of changing the geometry type.`,
    );
  }
  const code = layer.srs?.getAuthorityCode();
  if (String(code) !== '2056') {
    throw new SchemaMismatchError(`Layer "${id}": stored SRS is EPSG:${code ?? 'unknown'}, expected EPSG:2056.`);
  }
  for (const attr of def.attributes) {
    const idx = layer.fields.indexOf(attr.name);
    if (idx < 0) continue;
    const storedType = layer.fields.get(idx).type;
    const wanted = fieldTypeFor(attr);
    if (storedType !== wanted) {
      throw new SchemaMismatchError(
        `Layer "${id}", column "${attr.name}": stored type is ${storedType}, configured type "${attr.type}" needs ${wanted}. ` +
          `Rename the attribute (new column) instead of changing its type.`,
      );
    }
  }
}

const META_STRING_FIELDS = ['created_at', 'updated_at', 'created_by', 'updated_by'];

export function syncSchema(ds: gdal.Dataset, config: AppConfig): void {
  const srs = gdal.SpatialReference.fromEPSG(2056);

  for (const [id, def] of Object.entries(config.layers)) {
    const existing = findLayer(ds, id);
    if (existing) checkExisting(existing, id, def);
    const layer =
      existing ??
      ds.layers.create(id, srs, GEOM_TYPES[def.geometry], [
        'GEOMETRY_NAME=geom',
        'FID=fid',
        'SPATIAL_INDEX=YES',
      ]);
    for (const name of META_STRING_FIELDS) addField(layer, name, gdal.OFTString);
    for (const attr of def.attributes) {
      // gdal-async exposes no FieldDefn.subtype, so booleans are plain integers (0/1).
      addField(layer, attr.name, fieldTypeFor(attr));
    }
  }

  // Non-spatial photos table. GDAL always gives GPKG tables an integer FID, so the
  // uuid `id` is a separate string field made unique via an index.
  const photos = findLayer(ds, 'photos') ?? ds.layers.create('photos', null, gdal.wkbNone, ['FID=fid']);
  addField(photos, 'id', gdal.OFTString);
  addField(photos, 'layer', gdal.OFTString);
  addField(photos, 'feature_id', gdal.OFTInteger);
  addField(photos, 'filename', gdal.OFTString);
  addField(photos, 'content_type', gdal.OFTString);
  addField(photos, 'size', gdal.OFTInteger);
  addField(photos, 'created_at', gdal.OFTString);
  addField(photos, 'created_by', gdal.OFTString);
  ensurePhotosIdIndex(ds);
  ds.flush();
}
