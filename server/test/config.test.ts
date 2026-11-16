import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from '../src/config.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'minigis-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function write(yaml: string): string {
  const p = join(dir, 'c.yaml');
  writeFileSync(p, yaml);
  return p;
}

const base = (extraLayer = '', tree = '- layer: a', basemaps = '') => `
map: { center: [2613500, 1185100], zoom: 15 }
basemaps: []
tree:
  ${tree}
layers:
  a:
    title: A
    geometry: point
    style: { color: "#000000" }
    attributes: []
${extraLayer}
`;

const bmYaml = (d1?: boolean, d2?: boolean) => `
basemaps:
  - { id: b1, title: B1, layer: l1${d1 ? ', default: true' : ''} }
  - { id: b2, title: B2, layer: l2${d2 ? ', default: true' : ''} }
`;

// basemaps replaces the empty list in base()
const withBm = (bm: string) => base().replace('basemaps: []\n', bm.trim() + '\n');

describe('loadConfig', () => {
  it('loads config/minigis.yaml', () => {
    const cfg = loadConfig(fileURLToPath(new URL('../../config/minigis.yaml', import.meta.url)));
    expect(cfg.layers.abfallcontainer).toBeDefined();
  });

  it('rejects tree referencing unknown layer', () => {
    const p = write(base('', '- layer: ghost'));
    expect(() => loadConfig(p)).toThrow(ConfigError);
    expect(() => loadConfig(p)).toThrow(/tree.*ghost/s);
  });

  it('allows a layer not in tree', () => {
    const extra = '  b:\n    title: B\n    geometry: point\n    style: { color: "#000000" }\n    attributes: []';
    const cfg = loadConfig(write(base(extra)));
    expect(Object.keys(cfg.layers)).toEqual(['a', 'b']);
  });

  it('makes first basemap default when none is', () => {
    const cfg = loadConfig(write(withBm(bmYaml())));
    expect(cfg.basemaps.map((b) => b.default)).toEqual([true, false]);
  });

  it('keeps a single explicit default', () => {
    const cfg = loadConfig(write(withBm(bmYaml(false, true))));
    expect(cfg.basemaps.map((b) => !!b.default)).toEqual([false, true]);
  });

  it('rejects two default basemaps', () => {
    const p = write(withBm(bmYaml(true, true)));
    expect(() => loadConfig(p)).toThrow(ConfigError);
    expect(() => loadConfig(p)).toThrow(/default/);
  });

  it('throws ConfigError containing the path on invalid YAML', () => {
    const p = write('layers: [unclosed');
    expect(() => loadConfig(p)).toThrow(ConfigError);
    expect(() => loadConfig(p)).toThrow(p);
  });

  it('throws ConfigError containing the path when file is missing', () => {
    const p = join(dir, 'nope.yaml');
    expect(() => loadConfig(p)).toThrow(p);
  });
});
