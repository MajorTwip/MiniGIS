import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { configSchema } from '../src/index';

const cfgPath = fileURLToPath(new URL('../../config/minigis.yaml', import.meta.url));
const load = () => yaml.parse(readFileSync(cfgPath, 'utf8'));

describe('configSchema', () => {
  it('parses the example config', () => {
    const cfg = configSchema.parse(load());
    expect(cfg.layers.abfallcontainer.geometry).toBe('point');
    expect(cfg.app.userHeader).toBe('X-Authentik-Username');
    expect(cfg.app.maxPhotoMb).toBe(15);
    expect(cfg.layers.abfallcontainer.photos).toBe(true);
  });

  it('rejects bad layer id', () => {
    const raw = load();
    raw.layers['Abfall-Container'] = raw.layers.abfallcontainer;
    expect(configSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects reserved attribute name', () => {
    const raw = load();
    raw.layers.abfallcontainer.attributes.push({ name: 'fid', type: 'text' });
    expect(configSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects select without options', () => {
    const raw = load();
    raw.layers.abfallcontainer.attributes.push({ name: 'x', type: 'select' });
    expect(configSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects duplicate attribute names', () => {
    const raw = load();
    raw.layers.abfallcontainer.attributes.push({ name: 'nummer', type: 'text' });
    expect(configSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects tree referencing an undefined layer', () => {
    const raw = load();
    raw.tree[0].children.push({ layer: 'nope' });
    expect(configSchema.safeParse(raw).success).toBe(false);
  });
});

describe('symbol styling by attribute', () => {
  const layerWith = (style: Record<string, unknown>) => ({
    app: { title: 'T' },
    map: { center: [2600000, 1200000], zoom: 10 },
    basemaps: [{ id: 'b', title: 'B', layer: 'x', default: true }],
    tree: [{ layer: 'c' }],
    layers: {
      c: {
        title: 'C',
        geometry: 'point',
        style: { color: '#000', ...style },
        attributes: [
          { name: 'typ', type: 'select', options: ['Glas', 'Papier'] },
          { name: 'nummer', type: 'text' },
        ],
      },
    },
  });

  it('accepts symbols keyed by select options', () => {
    const r = configSchema.safeParse(
      layerWith({ symbolBy: 'typ', symbols: { Glas: { shape: 'star', color: '#0a0' }, Papier: { shape: 'square', color: '#00f' } } }),
    );
    expect(r.success).toBe(true);
  });

  it('rejects symbolBy pointing at a non-select attribute', () => {
    const r = configSchema.safeParse(layerWith({ symbolBy: 'nummer', symbols: {} }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/symbolBy/);
  });

  it('rejects a symbol for a value that is not an option', () => {
    const r = configSchema.safeParse(layerWith({ symbolBy: 'typ', symbols: { Blech: { shape: 'circle', color: '#000' } } }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/Blech/);
  });

  it('rejects an unknown shape', () => {
    const r = configSchema.safeParse(layerWith({ symbolBy: 'typ', symbols: { Glas: { shape: 'blob', color: '#000' } } }));
    expect(r.success).toBe(false);
  });

  it('the example config gives each container type its own symbol', () => {
    const cfg = configSchema.parse(load());
    const layer = cfg.layers.abfallcontainer;
    const options = layer.attributes.find((a) => a.name === 'typ')!.options!;
    expect(options).toEqual(
      expect.arrayContaining(['Gebührensäcke', 'Abfall Gemeinde', 'Neophyten', 'Schlamm']),
    );
    expect(layer.style.symbolBy).toBe('typ');
    for (const o of options) expect(layer.style.symbols?.[o]).toBeDefined();
    const keys = new Set(options.map((o) => `${layer.style.symbols![o].shape}|${layer.style.symbols![o].color}`));
    expect(keys.size).toBe(options.length);
  });
});

describe('vector basemaps and road snapping', () => {
  const minimal = (extra: Record<string, unknown> = {}) => ({
    map: { center: [2600000, 1200000], zoom: 10 },
    basemaps: [{ id: 'b', title: 'B', layer: 'x', default: true }],
    tree: [{ layer: 'l' }],
    layers: { l: { title: 'L', geometry: 'line', style: { color: '#000' }, attributes: [] } },
    ...extra,
  });

  it('accepts a vector basemap given by style URL', () => {
    const r = configSchema.safeParse(
      minimal({ basemaps: [{ id: 'v', title: 'V', style: 'https://example.org/style.json' }] }),
    );
    expect(r.success).toBe(true);
  });

  it('rejects a basemap with both layer and style, or with neither', () => {
    const both = { id: 'v', title: 'V', layer: 'x', style: 'https://example.org/style.json' };
    expect(configSchema.safeParse(minimal({ basemaps: [both] })).success).toBe(false);
    expect(configSchema.safeParse(minimal({ basemaps: [{ id: 'v', title: 'V' }] })).success).toBe(false);
  });

  it('defaults snapping to the swisstopo roads and snapToRoads to false', () => {
    const cfg = configSchema.parse(minimal());
    expect(cfg.snapping.tilejson).toContain('vectortiles.geo.admin.ch');
    expect(cfg.snapping.sourceLayer).toBe('transportation');
    expect(cfg.snapping.exclude).toContain('rail');
    expect(cfg.layers.l.snapToRoads).toBe(false);
  });

  it('the example config has Tiefbau → Strassenzustand as a snapping line layer', () => {
    const cfg = configSchema.parse(load());
    const tiefbau = cfg.tree.find((n) => 'group' in n && n.group === 'Tiefbau');
    expect(tiefbau && 'group' in tiefbau && tiefbau.children).toContainEqual({ layer: 'strassenzustand' });
    expect(cfg.layers.strassenzustand.geometry).toBe('line');
    expect(cfg.layers.strassenzustand.title).toBe('Strassenzustand');
    expect(cfg.layers.strassenzustand.snapToRoads).toBe(true);
    const def = cfg.basemaps.find((b) => b.default)!;
    expect('style' in def && def.style).toMatch(/vectortiles\.geo\.admin\.ch/);
  });
});
