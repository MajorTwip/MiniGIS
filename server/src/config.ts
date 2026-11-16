import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { configSchema, type AppConfig } from '@minigis/shared';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(path: string): AppConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new ConfigError(`${path}: cannot read file (${(e as Error).message})`);
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new ConfigError(`${path}: invalid YAML (${(e as Error).message})`);
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new ConfigError(`${path}: invalid config\n${lines.join('\n')}`);
  }

  const config = result.data;
  const defaults = config.basemaps.filter((b) => b.default).length;
  if (defaults > 1) {
    throw new ConfigError(`${path}: basemaps: at most one basemap may be marked default, found ${defaults}`);
  }
  if (defaults === 0 && config.basemaps.length > 0) {
    config.basemaps[0].default = true;
  }
  for (const b of config.basemaps) b.default = b.default === true;
  return config;
}
