import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { ensureConfig } from '../src/default-config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'minigis-cfg-'));
const quiet = () => {};

describe('ensureConfig', () => {
  it('keeps an existing config untouched', () => {
    const dir = tmp();
    const cfg = join(dir, 'minigis.yaml');
    writeFileSync(cfg, 'mine');
    const def = join(tmp(), 'default.yaml');
    writeFileSync(def, 'default');
    expect(ensureConfig(cfg, def, quiet)).toBe(cfg);
    expect(readFileSync(cfg, 'utf8')).toBe('mine');
  });

  it('copies the default when the config is missing, creating the folder', () => {
    const cfg = join(tmp(), 'sub', 'minigis.yaml');
    const def = join(tmp(), 'default.yaml');
    writeFileSync(def, 'default');
    const logs: string[] = [];
    expect(ensureConfig(cfg, def, (m) => logs.push(m))).toBe(cfg);
    expect(readFileSync(cfg, 'utf8')).toBe('default');
    expect(logs.join()).toMatch(/copied/i);
  });

  it('falls back to the built-in default when the config cannot be written', () => {
    // a file where the config folder should be makes the copy fail, like a read-only mount
    const blocker = join(tmp(), 'config');
    writeFileSync(blocker, '');
    const cfg = join(blocker, 'minigis.yaml');
    const def = join(tmp(), 'default.yaml');
    writeFileSync(def, 'default');
    const logs: string[] = [];
    expect(ensureConfig(cfg, def, (m) => logs.push(m))).toBe(def);
    expect(existsSync(cfg)).toBe(false);
    expect(logs.join()).toMatch(/could not/i);
  });

  it('throws a ConfigError when neither exists', () => {
    expect(() => ensureConfig(join(tmp(), 'x.yaml'), join(tmp(), 'nope.yaml'), quiet)).toThrow(ConfigError);
  });
});
