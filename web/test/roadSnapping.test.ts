import { describe, expect, it, vi } from 'vitest';
import Feature from 'ol/Feature';
import { LineString, Point } from 'ol/geom';
import { transform } from 'ol/proj';
import type { SnappingConfig } from '@minigis/shared';
import { MAX_TILES, RoadSnapper, tileCoordsForExtent, tileUrl, type RoadSnapperDeps } from '../src/map/roadSnapping';
import { registerLv95 } from '../src/map/projection';

registerLv95();

const config: SnappingConfig = {
  tilejson: 'https://tiles.example/base/tiles.json',
  sourceLayer: 'transportation',
  exclude: ['rail', 'path'],
};

// A ~400 m wide view around Brenzikofen.
const center = [2613500, 1185100];
const smallView = [center[0] - 200, center[1] - 200, center[0] + 200, center[1] + 200];

const merc = (lv95: number[]) => transform(lv95, 'EPSG:2056', 'EPSG:3857');

function fakeDeps(tileFeatures: () => Feature[]): RoadSnapperDeps & { fetchTile: ReturnType<typeof vi.fn> } {
  return {
    fetchTileJson: vi.fn().mockResolvedValue({ tiles: ['https://t{s}.example/{z}/{x}/{y}.pbf'.replace('{s}', '0')], maxzoom: 14 }),
    fetchTile: vi.fn().mockImplementation(async () => tileFeatures()),
  };
}

describe('tileCoordsForExtent', () => {
  it('covers a small LV95 view with a few z14 tiles over Switzerland', () => {
    const coords = tileCoordsForExtent(smallView, 14);
    expect(coords.length).toBeGreaterThan(0);
    expect(coords.length).toBeLessThanOrEqual(4);
    for (const [z, x, y] of coords) {
      expect(z).toBe(14);
      // Brenzikofen is around tile 14/8538/5781 (lon 7.6°, lat 46.8°)
      expect(x).toBeGreaterThan(8500);
      expect(x).toBeLessThan(8580);
      expect(y).toBeGreaterThan(5740);
      expect(y).toBeLessThan(5820);
    }
  });

  it('fills the tile URL template', () => {
    expect(tileUrl('https://a/{z}/{x}/{y}.pbf', [14, 1, 2])).toBe('https://a/14/1/2.pbf');
  });
});

describe('RoadSnapper', () => {
  const road = () =>
    new Feature({
      geometry: new LineString([merc([2613400, 1185100]), merc([2613600, 1185100])]),
      class: 'minor',
    });

  it('keeps roads, drops excluded classes and non-lines, and returns LV95 geometry', async () => {
    const deps = fakeDeps(() => [
      road(),
      new Feature({ geometry: new LineString([merc([2613400, 1185000]), merc([2613600, 1185000])]), class: 'rail' }),
      new Feature({ geometry: new LineString([merc([2613400, 1185050]), merc([2613600, 1185050])]), class: 'path' }),
      new Feature({ geometry: new Point(merc(center)), class: 'minor' }),
    ]);
    const statuses: string[] = [];
    const snapper = new RoadSnapper(config, (s) => statuses.push(s), deps);
    await snapper.load(smallView);
    const tiles = deps.fetchTile.mock.calls.length;
    const features = snapper.source.getFeatures();
    expect(features).toHaveLength(tiles); // one road per (fake) tile
    const [x, y] = (features[0].getGeometry() as LineString).getFirstCoordinate();
    expect(x).toBeCloseTo(2613400, 0);
    expect(y).toBeCloseTo(1185100, 0);
    expect(statuses).toEqual(['loading', 'ready']);
    expect(deps.fetchTile.mock.calls[0][0]).toMatch(/^https:\/\/t0\.example\/14\/\d+\/\d+\.pbf$/);
  });

  it('caches tiles and the TileJSON between loads', async () => {
    const deps = fakeDeps(() => [road()]);
    const snapper = new RoadSnapper(config, undefined, deps);
    await snapper.load(smallView);
    const calls = deps.fetchTile.mock.calls.length;
    await snapper.load(smallView);
    expect(deps.fetchTile.mock.calls.length).toBe(calls);
    expect(deps.fetchTileJson).toHaveBeenCalledTimes(1);
  });

  it('asks to zoom in instead of loading a huge view', async () => {
    const deps = fakeDeps(() => []);
    const statuses: string[] = [];
    const snapper = new RoadSnapper(config, (s) => statuses.push(s), deps);
    const big = [2560000, 1150000, 2660000, 1220000];
    expect(tileCoordsForExtent(big, 14).length).toBeGreaterThan(MAX_TILES);
    await snapper.load(big);
    expect(deps.fetchTile).not.toHaveBeenCalled();
    expect(statuses).toEqual(['zoom']);
  });

  it('reports errors and retries a failed tile later', async () => {
    let fail = true;
    const deps = fakeDeps(() => {
      if (fail) throw new Error('offline');
      return [road()];
    });
    const statuses: string[] = [];
    const snapper = new RoadSnapper(config, (s) => statuses.push(s), deps);
    await snapper.load(smallView);
    expect(statuses.at(-1)).toBe('error');
    fail = false;
    await snapper.load(smallView);
    expect(statuses.at(-1)).toBe('ready');
    expect(snapper.source.getFeatures().length).toBeGreaterThan(0);
  });

  it('reports an unreachable TileJSON as error', async () => {
    const deps = fakeDeps(() => []);
    (deps.fetchTileJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    const statuses: string[] = [];
    const snapper = new RoadSnapper(config, (s) => statuses.push(s), deps);
    await snapper.load(smallView);
    expect(statuses).toEqual(['error']);
    await snapper.load(smallView);
    expect(statuses.at(-1)).toBe('ready');
  });
});
