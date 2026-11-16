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
