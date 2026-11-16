import gdal from 'gdal-async';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { validateAttributes } from '@minigis/shared';
import type { AppConfig, AttributeDef, LayerDef } from '@minigis/shared';
import { findLayer, type Mutex } from './db.js';

export class ValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

export class UnknownLayerError extends Error {
  constructor(public readonly layer: string) {
    super(`Unknown layer: ${layer}`);
    this.name = 'UnknownLayerError';
  }
}

const GEOJSON_TYPE = { point: 'Point', line: 'LineString', polygon: 'Polygon' } as const;
const GEOM_ERR = {
  missing: 'Geometrie fehlt',
  type: 'Falscher Geometrietyp',
  invalid: 'Ungültige Geometrie',
};

export interface FeatureInput {
  geometry?: Geometry;
  properties?: Record<string, unknown>;
}

type Props = Record<string, string | number | boolean | null>;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function readDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') {
    const d = raw as { year: number; month: number; day: number };
    return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function readValue(attr: AttributeDef, raw: unknown): string | number | boolean | null {
  if (raw === null || raw === undefined) return null;
  switch (attr.type) {
    case 'boolean':
      return Number(raw) !== 0;
    case 'date':
      return readDate(raw);
    default:
      return raw as string | number;
  }
}

function writeValue(attr: AttributeDef, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (attr.type === 'boolean') return v ? 1 : 0;
  return v as string | number;
}

function ringDistinctCount(ring: number[][]): number {
  return new Set(ring.map((p) => `${p[0]},${p[1]}`)).size;
}

/** Checks type, non-emptiness and degeneracy on the GeoJSON; returns an error message or null. */
function checkGeoJson(def: LayerDef, geom: Geometry): string | null {
  if (geom.type !== GEOJSON_TYPE[def.geometry]) return GEOM_ERR.type;
  const g = geom as { coordinates?: unknown };
  if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return GEOM_ERR.invalid;
  if (geom.type === 'Point') {
    return geom.coordinates.length >= 2 && geom.coordinates.every(Number.isFinite) ? null : GEOM_ERR.invalid;
  }
  if (geom.type === 'LineString') {
    return ringDistinctCount(geom.coordinates) >= 2 ? null : GEOM_ERR.invalid;
  }
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) {
      if (ring.length < 4 || ringDistinctCount(ring) < 3) return GEOM_ERR.invalid;
    }
  }
  return null;
}

export class FeatureStore {
  constructor(
    private readonly ds: gdal.Dataset,
    private readonly config: AppConfig,
    private readonly mutex: Mutex,
  ) {}

  private def(layer: string): LayerDef {
    const def = Object.prototype.hasOwnProperty.call(this.config.layers, layer)
      ? this.config.layers[layer]
      : undefined;
    if (!def) throw new UnknownLayerError(layer);
    return def;
  }

  private open(layer: string): { def: LayerDef; lyr: gdal.Layer } {
    const def = this.def(layer);
    const lyr = findLayer(this.ds, layer);
    if (!lyr) throw new UnknownLayerError(layer);
    return { def, lyr };
  }

  private toGeoJson(def: LayerDef, f: gdal.Feature): Feature {
    const props: Props = {};
    for (const attr of def.attributes) props[attr.name] = readValue(attr, f.fields.get(attr.name));
    for (const k of ['created_at', 'updated_at', 'created_by', 'updated_by']) {
      props[k] = (f.fields.get(k) as string | null) ?? null;
    }
    const g = f.getGeometry();
    return {
      type: 'Feature',
      id: f.fid,
      geometry: g ? (g.toObject() as Geometry) : (null as unknown as Geometry),
      properties: props,
    };
  }

  /** Converts GeoJSON to a GDAL geometry, or returns an error message. */
  private parseGeometry(def: LayerDef, geom: unknown): { geom: gdal.Geometry } | { error: string } {
    if (!geom || typeof geom !== 'object') return { error: GEOM_ERR.missing };
    const g = geom as Geometry;
    let bad: string | null;
    try {
      bad = checkGeoJson(def, g);
    } catch {
      bad = GEOM_ERR.invalid; // malformed nested coordinates (e.g. [null])
    }
    if (bad) return { error: bad };
    let out: gdal.Geometry;
    try {
      out = gdal.Geometry.fromGeoJson(g);
    } catch {
      return { error: GEOM_ERR.invalid };
    }
    if (!out || out.isEmpty() || !out.isValid()) return { error: GEOM_ERR.invalid };
    out.srs = gdal.SpatialReference.fromEPSG(2056);
    return { geom: out };
  }

  async list(layer: string, bbox?: [number, number, number, number]): Promise<FeatureCollection> {
    const { def, lyr } = this.open(layer);
    if (bbox) lyr.setSpatialFilter(bbox[0], bbox[1], bbox[2], bbox[3]);
    try {
      const features: Feature[] = [];
      lyr.features.forEach((f) => {
        features.push(this.toGeoJson(def, f));
      });
      return { type: 'FeatureCollection', features };
    } finally {
      if (bbox) lyr.setSpatialFilter(null as never);
    }
  }

  async get(layer: string, fid: number): Promise<Feature | null> {
    const { def, lyr } = this.open(layer);
    return this.read(def, lyr, fid);
  }

  private read(def: LayerDef, lyr: gdal.Layer, fid: number): Feature | null {
    let f: gdal.Feature | null = null;
    try {
      f = lyr.features.get(fid);
    } catch {
      return null;
    }
    return f ? this.toGeoJson(def, f) : null;
  }

  private writeProps(def: LayerDef, f: gdal.Feature, values: Record<string, unknown>): void {
    for (const attr of def.attributes) {
      if (!(attr.name in values)) continue;
      f.fields.set(attr.name, writeValue(attr, values[attr.name]) as never);
    }
  }

  async create(layer: string, input: FeatureInput, user: string | null): Promise<Feature> {
    const { def, lyr } = this.open(layer);
    return this.mutex.run(async () => {
      const errors: Record<string, string> = {};
      const g = this.parseGeometry(def, input.geometry);
      if ('error' in g) errors.geometry = g.error;
      const v = validateAttributes(def, input.properties ?? {}, { applyDefaults: true });
      Object.assign(errors, v.errors);
      if (Object.keys(errors).length) throw new ValidationError(errors);

      const f = new gdal.Feature(lyr);
      f.setGeometry((g as { geom: gdal.Geometry }).geom);
      this.writeProps(def, f, v.values);
      const now = new Date().toISOString();
      f.fields.set('created_at', now);
      f.fields.set('updated_at', now);
      f.fields.set('created_by', user as never);
      f.fields.set('updated_by', user as never);
      lyr.features.add(f);
      lyr.flush();
      return this.toGeoJson(def, f);
    });
  }

  async update(layer: string, fid: number, input: FeatureInput, user: string | null): Promise<Feature | null> {
    const { def, lyr } = this.open(layer);
    return this.mutex.run(async () => {
      let f: gdal.Feature | null = null;
      try {
        f = lyr.features.get(fid);
      } catch {
        f = null;
      }
      if (!f) return null;

      const errors: Record<string, string> = {};
      let newGeom: gdal.Geometry | null = null;
      if (input.geometry !== undefined) {
        const g = this.parseGeometry(def, input.geometry);
        if ('error' in g) errors.geometry = g.error;
        else newGeom = g.geom;
      }
      const stored: Record<string, unknown> = {};
      for (const attr of def.attributes) stored[attr.name] = readValue(attr, f.fields.get(attr.name));
      const merged = { ...stored, ...(input.properties ?? {}) };
      const v = validateAttributes(def, merged);
      Object.assign(errors, v.errors);
      if (Object.keys(errors).length) throw new ValidationError(errors);

      if (newGeom) f.setGeometry(newGeom);
      this.writeProps(def, f, v.values);
      f.fields.set('updated_at', new Date().toISOString());
      f.fields.set('updated_by', user as never);
      lyr.features.set(f);
      lyr.flush();
      return this.read(def, lyr, fid);
    });
  }

  async delete(
    layer: string,
    fid: number,
    onDelete?: (layer: string, fid: number) => Promise<void>,
  ): Promise<boolean> {
    const { lyr } = this.open(layer);
    return this.mutex.run(async () => {
      let f: gdal.Feature | null = null;
      try {
        f = lyr.features.get(fid);
      } catch {
        f = null;
      }
      if (!f) return false;
      if (onDelete) await onDelete(layer, fid);
      lyr.features.remove(fid);
      lyr.flush();
      return true;
    });
  }
}
