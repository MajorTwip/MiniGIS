import Feature from 'ol/Feature';
import VectorSource from 'ol/source/Vector';
import MVT from 'ol/format/MVT';
import { createXYZ } from 'ol/tilegrid';
import { transformExtent } from 'ol/proj';
import type { Extent } from 'ol/extent';
import type { Geometry } from 'ol/geom';
import type { SnappingConfig } from '@minigis/shared';
import { registerLv95 } from './projection';

/** At most this many tiles are loaded for one view; zoomed further out, snapping waits. */
export const MAX_TILES = 36;

export type SnapStatus = 'idle' | 'loading' | 'ready' | 'zoom' | 'error';

const grid = createXYZ({ extent: [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244] });

/** XYZ tile coordinates `[z, x, y]` covering an LV95 extent at zoom `z`. */
export function tileCoordsForExtent(extent2056: Extent, z: number): [number, number, number][] {
  registerLv95();
  const merc = transformExtent(extent2056, 'EPSG:2056', 'EPSG:3857');
  const range = grid.getTileRangeForExtentAndZ(merc, z);
  const out: [number, number, number][] = [];
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) out.push([z, x, y]);
  }
  return out;
}

export function tileUrl(template: string, [z, x, y]: [number, number, number]): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

type TileJson = { tiles: string[]; maxzoom?: number };

export interface RoadSnapperDeps {
  fetchTileJson: (url: string) => Promise<TileJson>;
  /** Features of one tile, geometries in EPSG:3857. */
  fetchTile: (url: string, tileExtent3857: Extent) => Promise<Feature[]>;
}

const defaultDeps = (sourceLayer: string): RoadSnapperDeps => {
  const format = new MVT<Feature>({ featureClass: Feature, layers: [sourceLayer] });
  return {
    async fetchTileJson(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return (await res.json()) as TileJson;
    },
    async fetchTile(url, tileExtent) {
      const res = await fetch(url);
      if (res.status === 404 || res.status === 204) return []; // no data there
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return format.readFeatures(buf, { extent: tileExtent, featureProjection: 'EPSG:3857' });
    },
  };
};

/**
 * Road geometries (swisstopo vector tiles) for snapping, in LV95.
 * Tiles are fetched at the tileset's max zoom for full detail and cached for the session.
 */
export class RoadSnapper {
  readonly source = new VectorSource<Feature>();
  private template: Promise<{ url: string; z: number }> | null = null;
  private tiles = new Map<string, Promise<void>>();
  private generation = 0;
  private deps: RoadSnapperDeps;
  private exclude: Set<string>;

  constructor(
    private config: SnappingConfig,
    private onStatus: (s: SnapStatus) => void = () => {},
    deps?: RoadSnapperDeps,
  ) {
    this.deps = deps ?? defaultDeps(config.sourceLayer);
    this.exclude = new Set(config.exclude);
  }

  /** Make sure the roads inside `extent2056` are in `source`. */
  async load(extent2056: Extent): Promise<void> {
    const gen = ++this.generation;
    let tpl: { url: string; z: number };
    try {
      tpl = await this.tileTemplate();
    } catch {
      this.template = null; // retry on the next call
      if (gen === this.generation) this.onStatus('error');
      return;
    }
    const coords = tileCoordsForExtent(extent2056, tpl.z);
    if (coords.length > MAX_TILES) {
      if (gen === this.generation) this.onStatus('zoom');
      return;
    }
    if (gen === this.generation) this.onStatus('loading');
    const results = await Promise.allSettled(coords.map((c) => this.loadTile(tpl.url, c)));
    if (gen !== this.generation) return; // a newer view superseded this one
    this.onStatus(results.some((r) => r.status === 'rejected') ? 'error' : 'ready');
  }

  /** Forget the pending view so a stale load cannot change the status any more. */
  reset(): void {
    this.generation++;
    this.onStatus('idle');
  }

  private tileTemplate(): Promise<{ url: string; z: number }> {
    this.template ??= this.deps.fetchTileJson(this.config.tilejson).then((tj) => {
      if (!tj.tiles?.length) throw new Error('TileJSON without tiles');
      const t = tj.tiles[0];
      // Resolve a relative template without URL-encoding its {z}/{x}/{y} placeholders.
      const url = /^https?:\/\//.test(t) ? t : new URL('.', this.config.tilejson).href + t.replace(/^\.?\//, '');
      return { url, z: tj.maxzoom ?? 14 };
    });
    return this.template;
  }

  private loadTile(template: string, coord: [number, number, number]): Promise<void> {
    const key = coord.join('/');
    let p = this.tiles.get(key);
    if (!p) {
      p = this.deps
        .fetchTile(tileUrl(template, coord), grid.getTileCoordExtent(coord))
        .then((features) => this.source.addFeatures(this.roads(features)))
        .catch((e) => {
          this.tiles.delete(key); // retry later
          throw e;
        });
      this.tiles.set(key, p);
    }
    return p;
  }

  private roads(features: Feature[]): Feature[] {
    const out: Feature[] = [];
    for (const f of features) {
      const geom = f.getGeometry() as Geometry | undefined;
      if (!geom) continue;
      const type = geom.getType();
      if (type !== 'LineString' && type !== 'MultiLineString') continue;
      if (this.exclude.has(String(f.get('class')))) continue;
      geom.transform('EPSG:3857', 'EPSG:2056');
      out.push(new Feature({ geometry: geom, class: f.get('class') }));
    }
    return out;
  }
}
